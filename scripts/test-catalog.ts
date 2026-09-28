import assert from "node:assert/strict";
import { parseMojangVersions, serverCatalog, validCatalogVersion } from "../src/lib/catalog";
const parsed=parseMojangVersions({versions:[
  {id:"1.22.1",type:"release",releaseTime:"2026-01-01T00:00:00Z"},
  {id:"26w10a",type:"snapshot",releaseTime:"2026-02-01T00:00:00Z"},
  {id:"ignored",type:"old_alpha"},
]});
assert.deepEqual(parsed.map(x=>[x.id,x.channel]),[["1.22.1","stable"],["26w10a","preview"]]);
const catalog=serverCatalog();
assert.ok(catalog.find(x=>x.id==="minecraft")?.automatic);
assert.equal(catalog.find(x=>x.id==="custom")?.automatic,false);
assert.equal(validCatalogVersion("minecraft","1.22.1"),true);
assert.equal(validCatalogVersion("minecraft","../../evil"),false);
for(const item of catalog.filter(x=>x.automatic)) assert.match(item.sourceUrl,/^https:\/\//);
console.log("IN_APP_SERVER_CATALOG_OK",{games:catalog.length});
