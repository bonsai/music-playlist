import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { importTs } from "./helpers/bundle.mjs";

const { md5 } = await importTs("shared/md5.ts", "md5");

test("matches known vectors", () => {
  assert.equal(md5(""), "d41d8cd98f00b204e9800998ecf8427e");
  assert.equal(md5("a"), "0cc175b9c0f1b6a831c399e269772661");
  assert.equal(md5("abc"), "900150983cd24fb0d6963f7d28e17f72");
  assert.equal(md5("message digest"), "f96b697d7cb7938d525a2f31aaf161d0");
  assert.equal(md5("abcdefghijklmnopqrstuvwxyz"), "c3fcd3d76192e4007dfb496cca67e13b");
  assert.equal(
    md5("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"),
    "d174ab98d277d9f5a5611c2c9f419d9f",
  );
  assert.equal(
    md5("12345678901234567890123456789012345678901234567890123456789012345678901234567890"),
    "57edf4a22be3c955ac49da2e2107b67a",
  );
});

test("agrees with node crypto over random unicode input", () => {
  for (let i = 0; i < 200; i += 1) {
    const s = Array.from({ length: i * 3 % 97 }, () => String.fromCodePoint(Math.floor(Math.random() * 0x2fff)))
      .join("");
    assert.equal(md5(s), createHash("md5").update(s, "utf8").digest("hex"), JSON.stringify(s));
  }
});

test("is stable for the Last.fm signature input shape", () => {
  const canonical = "albumXartistYmethodtrack.scrobbletimestampZ";
  assert.match(md5(`${canonical}secret`), /^[0-9a-f]{32}$/);
});