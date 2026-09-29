const Module = require("node:module");
const original = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "better-sqlite3") return class BetterSqlite3Stub { constructor() { throw new Error("test stub must not be instantiated"); } };
  return original.call(this, request, parent, isMain);
};
