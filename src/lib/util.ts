import { SHA3 } from 'sha3';
import { sha256 } from '@initia/minitia.js';

export function sha3_256(value: Buffer | string | number) {
  value = toBuffer(value);

  return new SHA3(256).update(value as Buffer).digest();
}

function toBuffer(value: any) {
  if (!Buffer.isBuffer(value)) {
    if (Array.isArray(value)) {
      value = Buffer.from(value);
    } else if (typeof value === 'string') {
      if (isHexString(value)) {
        value = Buffer.from(padToEven(stripHexPrefix(value)), 'hex');
      } else {
        value = Buffer.from(value);
      }
    } else if (typeof value === 'number') {
      value = intToBuffer(value);
    } else if (value === null || value === undefined) {
      value = Buffer.allocUnsafe(0);
    } else if (value.toArray) {
      // converts a BN to a Buffer
      value = Buffer.from(value.toArray());
    } else {
      throw new Error('invalid type');
    }
  }

  return value;
}

function isHexString(value: any, length?: number) {
  if (typeof value !== 'string' || !value.match(/^0x[0-9A-Fa-f]*$/)) {
    return false;
  }

  if (length && value.length !== 2 + 2 * length) {
    return false;
  }

  return true;
}

function padToEven(value: any) {
  if (typeof value !== 'string') {
    throw new Error(
      `while padding to even, value must be string, is currently ${typeof value}, while padToEven.`
    );
  }

  if (value.length % 2) {
    value = `0${value}`;
  }

  return value;
}

function stripHexPrefix(value: any) {
  if (typeof value !== 'string') {
    return value;
  }

  return isHexPrefixed(value) ? value.slice(2) : value;
}

function isHexPrefixed(value: any) {
  if (typeof value !== 'string') {
    throw new Error(
      "value must be type 'string', is currently type " +
        typeof value +
        ', while checking isHexPrefixed.'
    );
  }

  return value.slice(0, 2) === '0x';
}

function intToBuffer(i: number) {
  const hex = intToHex(i);
  return Buffer.from(padToEven(hex.slice(2)), 'hex');
}

function intToHex(i: number) {
  const hex = i.toString(16);
  return `0x${hex}`;
}

export function createOutputRoot(
  version: number,
  stateRoot: string,
  storageRoot: string,
  latestBlockHash: string
): string {
  return sha3_256(
    Buffer.concat([
      Buffer.from(version.toString()),
      Buffer.from(stateRoot, 'hex'),
      Buffer.from(storageRoot, 'hex'),
      Buffer.from(latestBlockHash, 'base64')
    ])
  ).toString('hex');
}

export function structTagToDenom(structTag: string): string {
  if (structTag.startsWith('0x1::native_')) {
    return structTag.split('::')[1].split('_')[1];
  } else if (structTag.startsWith('0x1::ibc_')) {
    return `ibc/${structTag.split('::')[1].split('_')[1]}`;
  } else {
    const shaSum = sha256(Buffer.from(structTag));
    const hash = Buffer.from(shaSum).toString('hex');
    return `move/${hash}`;
  }
}
