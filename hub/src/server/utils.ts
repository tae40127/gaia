

import stream from 'stream'
import { DriverConstructor, DriverStatics } from './driverModel'
import S3Driver from './drivers/S3Driver'
import AzDriver from './drivers/AzDriver'
import GcDriver from './drivers/GcDriver'
import DiskDriver from './drivers/diskDriver'
import { promisify } from 'util'
import winston from 'winston'

import { pipeline } from 'stream'
import { DriverName } from './config'

import nanoid = require('nanoid/generate')

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * Generates a random 10 char string using uppercase & lowercase alpha numeric alphabet.
 */
export function generateUniqueID() {
  const id = nanoid(alphabet, 10) //=> "mAB6Yps3V3"
  return id
}


export const pipelineAsync = promisify(pipeline)

export const logger = winston.createLogger()

export function getDriverClass(driver: DriverName): DriverConstructor & DriverStatics {
  if (driver === 'aws') {
    return S3Driver
  } else if (driver === 'azure') {
    return AzDriver
  } else if (driver === 'disk') {
    return DiskDriver
  } else if (driver === 'google-cloud') {
    return GcDriver
  } else {
    throw new Error(`Failed to load driver: driver was set to ${driver}`)
  }
}


class MemoryStream extends stream.Writable {
  buffers: Buffer[]
  constructor(opts?: stream.WritableOptions) {
    super(opts)
    this.buffers = []
  }
  _write(chunk: any, encoding: string, callback: (error?: Error | null) => void): void {
    this.buffers.push(Buffer.from(chunk, encoding))
    callback(null)
  }
  getData() {
    if (this.buffers.length === 1) {
      return this.buffers[0]
    }
    return Buffer.concat(this.buffers)
  }
}

export async function readStream(stream: stream.Readable): Promise<Buffer> {
  const memStream = new MemoryStream()
  await pipelineAsync(stream, memStream)
  return memStream.getData()
}

export function timeout(milliseconds: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve()
    }, milliseconds)
  })
}


export class AsyncMutexScope {

  private readonly _opened = new Set<string>()

  public get openedCount() {
    return this._opened.size
  }

  /**
   * If no mutex of the given `id` is already taken, then a mutex is created and the 
   * given promise is invoked. The mutex is released once the promise resolves -- either by 
   * success or error. 
   * @param id A unique mutex name used in a Map.
   * @param spawnOwner A function that creates a Promise if the mutex is acquired. 
   * @returns `true` if the mutex was acquired, otherwise returns `false`
   */
  public tryAcquire(id: string, spawnOwner: () => Promise<void>): boolean {
    if (this._opened.has(id)) {
      return false
    }

    // Lock before invoking the given func to prevent potential synchronous 
    // reentrant locking attempts. 
    this._opened.add(id)
    
    try {
      const owner = spawnOwner()
      // If spawnOwner does not throw an error then we can safely attach the
      // unlock to the returned Promise. Once the Promise has evaluated (with or 
      // without error), we unlock. 
      owner.finally(() => {
        this._opened.delete(id)
      })
    } catch (error) {
      // If spawnOwner throws a synchronous error then unlock and re-throw the
      // error for the caller to handle. This is okay in js because re-throwing
      // an error preserves the original error call stack. 
      this._opened.delete(id)
      throw error
    }
    return true
  }

}
