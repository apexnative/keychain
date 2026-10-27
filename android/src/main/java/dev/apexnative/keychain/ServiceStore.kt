package dev.apexnative.keychain

import android.util.AtomicFile
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException

/**
 * One service's items: its file, written through `AtomicFile`, and its cache in memory. Reads take the
 * cache as it is, without a lock; writes take the service's lock, write the file and only then replace the cache, so a
 * failed write leaves both as they were. The file is read on the first access, not before.
 */
internal class ServiceStore(val service: String, directory: File) {
    private val file = AtomicFile(File(directory, StoreFormat.fileName(service)))
    private val lock = Any()

    @Volatile
    private var data: StoreData? = null

    /**
     * The service's Keystore aliases by profile id, read from the Keystore on the first write. Only under [update]'s
     * lock.
     */
    var keyAliases: MutableMap<String, String>? = null

    /** The items as they are now; a file that can't be read is DATA_CORRUPTED, and is read again next time. */
    fun snapshot(): StoreData = data ?: synchronized(lock) { data ?: read().also { data = it } }

    /**
     * Changes the items under the service's lock: [change] gets the current ones and gives the new ones, or null when
     * nothing changes. The file is written before the cache is replaced; the result is what the store holds after.
     */
    fun update(change: (StoreData) -> StoreData?): StoreData = synchronized(lock) {
        val current = snapshot()
        val next = change(current) ?: return current
        write(next)
        data = next
        next
    }

    /** Deletes the file, then [deleteKeys]: a store without a file is empty, whatever keys are left. */
    fun clear(deleteKeys: () -> Unit) = synchronized(lock) {
        deleteFile()
        data = StoreData(service, emptyMap())
        keyAliases = null
        deleteKeys()
    }

    private fun read(): StoreData {
        val bytes = try {
            file.readFully()
        } catch (e: FileNotFoundException) {
            return StoreData(service, emptyMap())
        }
        return StoreFormat.decode(bytes, service)
    }

    // An empty store has no file.
    private fun write(next: StoreData) {
        if (next.items.isEmpty()) {
            deleteFile()
            return
        }
        val bytes = StoreFormat.encode(next)
        file.baseFile.parentFile?.mkdirs()
        val stream = file.startWrite()
        try {
            stream.write(bytes)
            file.finishWrite(stream)
        } catch (e: IOException) {
            file.failWrite(stream)
            throw e
        }
    }

    // `AtomicFile.delete` doesn't say whether it could.
    private fun deleteFile() {
        file.delete()
        if (file.baseFile.exists()) throw IOException("Can't delete ${file.baseFile}")
    }
}
