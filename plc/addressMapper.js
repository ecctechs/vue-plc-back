function mapAddress(address) {
  const { type, start, length } = address;

  return {
    type,
    start: Number(start),
    length: Number(length || 1),
  };
}

module.exports = { mapAddress };