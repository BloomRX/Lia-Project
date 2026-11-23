function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('lia-stage-avatar', 1)
    request.onupgradeneeded = () => { request.result.createObjectStore('avatars') }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transact(mode, operation) {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('avatars', mode)
      const request = operation(transaction.objectStore('avatars'))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error)
    })
  }
  finally {
    db.close()
  }
}

export const readSavedAvatar = () => transact('readonly', store => store.get('selected'))
export const saveAvatar = bytes => transact('readwrite', store => store.put(bytes, 'selected'))
export const removeSavedAvatar = () => transact('readwrite', store => store.delete('selected'))
