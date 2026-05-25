import Hashids from 'hashids';

const h = new Hashids('qpzmrld10vsljklfgdnsdsafjkhfl526742228666777mzpqnxowhgf', 6);

export const encodeId   = id   => h.encode(id);
export const decodeHash = hash => {
  const dec = h.decode(hash);
  return dec.length > 0 ? Number(dec[0]) : null;
};
