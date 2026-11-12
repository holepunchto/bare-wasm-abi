// Captured when the module loads, so that later changes to the built-ins of
// the host realm cannot change what the ABI calls. Each one checks the internal
// slots of its receiver, so none runs code of the value it is given.

const TypedArray = Object.getPrototypeOf(Uint8Array)

module.exports = {
  typedArrayBuffer: getter(TypedArray.prototype, 'buffer'),
  typedArrayByteOffset: getter(TypedArray.prototype, 'byteOffset'),
  typedArrayByteLength: getter(TypedArray.prototype, 'byteLength'),
  typedArrayLength: getter(TypedArray.prototype, 'length'),
  typedArrayName: getter(TypedArray.prototype, Symbol.toStringTag),
  arrayBufferByteLength: getter(ArrayBuffer.prototype, 'byteLength'),
  arrayBufferDetached: getter(ArrayBuffer.prototype, 'detached'),
  dataViewBuffer: getter(DataView.prototype, 'buffer'),
  dataViewByteOffset: getter(DataView.prototype, 'byteOffset'),
  dataViewByteLength: getter(DataView.prototype, 'byteLength'),
  arrayBufferTransfer: ArrayBuffer.prototype.transfer,
  dateValue: Date.prototype.valueOf
}

function getter(object, key) {
  return Object.getOwnPropertyDescriptor(object, key).get
}
