import assert from "node:assert/strict";
import { assertSupportBundleEntries, SUPPORT_BUNDLE_ENTRIES } from "../src/lib/support-bundle-policy";
import { sanitizeSupportText } from "../src/lib/support-redaction";

assert.doesNotThrow(()=>assertSupportBundleEntries([...SUPPORT_BUNDLE_ENTRIES]));
for(const name of ["serverhub.db","world/level.dat","../secret.txt","credentials.json","C:\\Users\\Ahri\\config.ini"]){
  const entries=[...SUPPORT_BUNDLE_ENTRIES.filter(item=>item!=="build-info.json"),name];
  assert.throws(()=>assertSupportBundleEntries(entries),name);
}
assert.throws(()=>assertSupportBundleEntries([...SUPPORT_BUNDLE_ENTRIES,"summary.json"]));
assert.throws(()=>assertSupportBundleEntries(SUPPORT_BUNDLE_ENTRIES.filter(name=>name!=="SHA256SUMS")));
const serialized=sanitizeSupportText(JSON.stringify({password:"hunter2",ownerId:"player-123",home:"C:\\Users\\Ahri\\ServerHub",vault:"dpapi:user:v1:QUJDRA=="}),["C:\\Users\\Ahri\\ServerHub"]);
for(const forbidden of ["hunter2","player-123","Ahri","QUJDRA"]){assert.equal(serialized.includes(forbidden),false,forbidden)}
console.log("SUPPORT_BUNDLE_ALLOWLIST_REGRESSION_OK");
