// In-memory stand-in for a Mongoose model, for tests that drive real
// controllers/services without a database. Installs itself by shadowing the
// static query methods on the real model object (own-property assignment), and
// records every filter it was called with so tests can assert tenant scoping.
import { randomBytes } from "node:crypto";

const newId = () => randomBytes(12).toString("hex");

function getPath(doc, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), doc);
}

function eq(a, b) {
  if (a == null && b == null) return true; // null matches missing, like Mongo
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

function matchCond(value, cond) {
  if (cond && typeof cond === "object" && !Array.isArray(cond) && !(cond instanceof Date)) {
    const ops = Object.keys(cond);
    if (ops.length && ops.every((k) => k.startsWith("$"))) {
      return ops.every((op) => {
        const arg = cond[op];
        switch (op) {
          case "$in":
            return arg.some((x) => eq(value, x));
          case "$nin":
            return !arg.some((x) => eq(value, x));
          case "$ne":
            return !eq(value, arg);
          case "$exists":
            return arg ? value !== undefined : value === undefined;
          case "$regex":
            return new RegExp(arg).test(String(value ?? ""));
          default:
            throw new Error(`fakeModel: unsupported operator ${op}`);
        }
      });
    }
  }
  return eq(value, cond);
}

export function matches(doc, filter = {}) {
  return Object.entries(filter).every(([k, cond]) => {
    if (k === "$or") return cond.some((f) => matches(doc, f));
    if (k === "$and") return cond.every((f) => matches(doc, f));
    return matchCond(getPath(doc, k), cond);
  });
}

function applyUpdate(doc, update = {}, isInsert = false) {
  const hasOps = Object.keys(update).some((k) => k.startsWith("$"));
  const set = hasOps ? update.$set || {} : update;
  Object.assign(doc, set);
  if (isInsert && update.$setOnInsert) Object.assign(doc, update.$setOnInsert);
  if (update.$inc) {
    for (const [p, n] of Object.entries(update.$inc)) {
      const parts = p.split(".");
      let o = doc;
      for (const part of parts.slice(0, -1)) o = o[part] = o[part] || {};
      const last = parts[parts.length - 1];
      o[last] = (o[last] || 0) + n;
    }
  }
  return doc;
}

function query(result) {
  // Chainable thenable: .sort().lean().limit() are accepted and ignored except sort/limit.
  let value = result;
  const q = {
    sort(spec) {
      if (Array.isArray(value) && spec) {
        const [[k, dir]] = Object.entries(spec);
        value = [...value].sort((a, b) => (String(a[k]) > String(b[k]) ? dir : String(a[k]) < String(b[k]) ? -dir : 0));
      }
      return q;
    },
    limit(n) {
      if (Array.isArray(value)) value = value.slice(0, n);
      return q;
    },
    select() {
      return q;
    },
    lean() {
      return q;
    },
    exec() {
      return Promise.resolve(value);
    },
    then(res, rej) {
      return Promise.resolve(value).then(res, rej);
    },
    catch(rej) {
      return Promise.resolve(value).catch(rej);
    },
  };
  return q;
}

/**
 * @param {object} Model real mongoose model to shadow
 * @param {object} [opts]
 * @param {Array<object>} [opts.docs] initial rows
 * @param {Array<Array<string>>} [opts.unique] compound unique keys, e.g. [["tenantId","key"]]
 */
export function installFakeModel(Model, { docs = [], unique = [] } = {}) {
  const store = docs.map((d) => ({ _id: d._id || newId(), ...d }));
  const calls = [];
  const saved = {};
  const names = [
    "find",
    "findOne",
    "findById",
    "findByIdAndUpdate",
    "findByIdAndDelete",
    "findOneAndUpdate",
    "findOneAndDelete",
    "updateOne",
    "updateMany",
    "deleteOne",
    "create",
    "countDocuments",
  ];
  for (const n of names) saved[n] = Object.prototype.hasOwnProperty.call(Model, n) ? Model[n] : undefined;

  const record = (op, filter) => calls.push({ op, filter: filter ? JSON.parse(JSON.stringify(filter)) : filter });
  const checkUnique = (candidate, selfId) => {
    for (const keys of unique) {
      const clash = store.find(
        (d) => d._id !== selfId && keys.every((k) => eq(d[k], candidate[k]))
      );
      if (clash) {
        const err = new Error("E11000 duplicate key error");
        err.code = 11000;
        err.keyPattern = Object.fromEntries(keys.map((k) => [k, 1]));
        err.keyValue = Object.fromEntries(keys.map((k) => [k, candidate[k]]));
        throw err;
      }
    }
  };

  Model.find = (filter = {}) => {
    record("find", filter);
    return query(store.filter((d) => matches(d, filter)).map((d) => ({ ...d })));
  };
  Model.findOne = (filter = {}) => {
    record("findOne", filter);
    const d = store.find((x) => matches(x, filter));
    return query(d ? { ...d } : null);
  };
  Model.findById = (id) => {
    record("findById", { _id: id });
    const d = store.find((x) => eq(x._id, id));
    return query(d ? { ...d } : null);
  };
  Model.findByIdAndUpdate = (id, update) => {
    record("findByIdAndUpdate", { _id: id });
    const d = store.find((x) => eq(x._id, id));
    if (d) applyUpdate(d, update);
    return query(d ? { ...d } : null);
  };
  Model.findByIdAndDelete = (id) => {
    record("findByIdAndDelete", { _id: id });
    const i = store.findIndex((x) => eq(x._id, id));
    const [d] = i >= 0 ? store.splice(i, 1) : [null];
    return query(d);
  };
  Model.findOneAndUpdate = (filter, update, opts = {}) => {
    record("findOneAndUpdate", filter);
    let d = store.find((x) => matches(x, filter));
    if (d) {
      const next = applyUpdate({ ...d }, update);
      checkUnique(next, d._id);
      applyUpdate(d, update);
    } else if (opts.upsert) {
      const base = Object.fromEntries(
        Object.entries(filter).filter(([k, v]) => !k.startsWith("$") && (v === null || typeof v !== "object"))
      );
      d = applyUpdate({ _id: newId(), ...base }, update, true);
      checkUnique(d);
      store.push(d);
    }
    return query(d ? { ...d } : null);
  };
  Model.findOneAndDelete = (filter) => {
    record("findOneAndDelete", filter);
    const i = store.findIndex((x) => matches(x, filter));
    const [d] = i >= 0 ? store.splice(i, 1) : [null];
    return query(d);
  };
  Model.updateOne = (filter, update) => {
    record("updateOne", filter);
    const d = store.find((x) => matches(x, filter));
    if (d) applyUpdate(d, update);
    return query({ matchedCount: d ? 1 : 0, modifiedCount: d ? 1 : 0 });
  };
  Model.updateMany = (filter, update) => {
    record("updateMany", filter);
    const hits = store.filter((x) => matches(x, filter));
    hits.forEach((d) => applyUpdate(d, update));
    return query({ matchedCount: hits.length, modifiedCount: hits.length });
  };
  Model.deleteOne = (filter) => {
    record("deleteOne", filter);
    const i = store.findIndex((x) => matches(x, filter));
    if (i >= 0) store.splice(i, 1);
    return query({ deletedCount: i >= 0 ? 1 : 0 });
  };
  Model.create = async (doc) => {
    record("create", null);
    const d = { _id: newId(), ...doc };
    checkUnique(d);
    store.push(d);
    return { ...d };
  };
  Model.countDocuments = (filter = {}) => {
    record("countDocuments", filter);
    return query(store.filter((d) => matches(d, filter)).length);
  };

  return {
    store,
    calls,
    restore() {
      for (const n of names) {
        if (saved[n] === undefined) delete Model[n];
        else Model[n] = saved[n];
      }
    },
  };
}

export function mkRes() {
  const r = { statusCode: 200, body: undefined };
  const send = (status, body) => {
    r.statusCode = status;
    r.body = body;
    return r;
  };
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (b) => ((r.body = b), r);
  r.send = (b) => ((r.body = b), r);
  r.success = (data, message) => send(200, { status: "success", message, data });
  r.created = (data, message) => send(201, { status: "success", message, data });
  r.fail = (message, status = 400) => send(status, { status: "fail", message });
  r.notFound = (message) => send(404, { status: "fail", message });
  r.forbidden = (message) => send(403, { status: "fail", message });
  r.notFoundRecord = (message) => send(200, { success: true, data: null, message });
  return r;
}
