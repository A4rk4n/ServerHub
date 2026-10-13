// Steam Workshop integration (workshop.ts): input parsing, API payload
// shaping, response mapping, activation generation, update verdicts,
// and the route/page wiring pins.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { GAMES } from "../src/lib/games";
import {
  activationFor,
  collectionRequestBody,
  detailsRequestBody,
  mapCollectionChildren,
  mapPublishedFile,
  parseWorkshopInput,
  steamcmdDownloadCommand,
  WORKSHOP_SOURCE,
  workshopUpdateStatus,
} from "../src/lib/workshop";

test("input parsing: bare ids and steamcommunity URLs only", () => {
  assert.equal(parseWorkshopInput("731604991"), "731604991");
  assert.equal(parseWorkshopInput("  731604991 "), "731604991");
  assert.equal(parseWorkshopInput("https://steamcommunity.com/sharedfiles/filedetails/?id=731604991"), "731604991");
  assert.equal(parseWorkshopInput("https://steamcommunity.com/workshop/filedetails/?id=123&searchtext=x"), "123");
  assert.equal(parseWorkshopInput("https://evil.example.com/sharedfiles/filedetails/?id=123"), null, "foreign hosts are refused");
  assert.equal(parseWorkshopInput("https://notsteamcommunity.com/?id=123"), null, "suffix spoofing is refused");
  assert.equal(parseWorkshopInput("drop table"), null);
  assert.equal(parseWorkshopInput(""), null);
});

test("API payload and response mapping", () => {
  const body = detailsRequestBody(["11", "22"]);
  assert.equal(body.get("itemcount"), "2");
  assert.equal(body.get("publishedfileids[0]"), "11");
  assert.equal(body.get("publishedfileids[1]"), "22");

  const mapped = mapPublishedFile({
    result: 1, publishedfileid: "731604991", title: "Structures Plus (S+)",
    description: "Building  overhaul\n\nwith   snap points", time_updated: 1700000000,
    subscriptions: 2500000, consumer_app_id: 346110, file_size: 123456789,
  });
  assert.ok(mapped);
  assert.equal(mapped.title, "Structures Plus (S+)");
  assert.equal(mapped.description, "Building overhaul with snap points", "whitespace collapsed");
  assert.equal(mapped.consumerAppId, 346110);
  assert.equal(mapPublishedFile({ result: 9, publishedfileid: "1" }), null, "unavailable items map to null");
  assert.equal(mapPublishedFile({ result: 1, publishedfileid: "nope" }), null);
});

test("activation + download commands per game", () => {
  const ark = activationFor("ark", ["731604991", "123"]);
  assert.equal(ark.line, "ActiveMods=731604991,123");
  assert.ok(ark.hint.includes("GameUserSettings.ini"));
  const terraria = activationFor("terraria", ["5"]);
  assert.equal(terraria.line, null, "Terraria worlds have no mod-list line");
  assert.ok(terraria.hint.includes("serverconfig.txt"));
  assert.equal(steamcmdDownloadCommand(346110, "731604991"), "steamcmd +login anonymous +workshop_download_item 346110 731604991 +quit");
});

test("update verdicts and the games catalog wiring", () => {
  const latest = { fileId: "1", title: "", description: "", timeUpdated: 200, subscriptions: 0, consumerAppId: 0, fileSize: 0 };
  assert.equal(workshopUpdateStatus("100", latest), "update");
  assert.equal(workshopUpdateStatus("200", latest), "current");
  assert.equal(workshopUpdateStatus("100", undefined), "unknown");

  const ark = GAMES.find((game) => game.id === "ark")!;
  assert.equal(ark.workshop?.appId, 346110, "ARK Workshop lives under the client appid, not the server depot");
  assert.equal(ark.steamAppId, 376030, "server depot unchanged");
  const terraria = GAMES.find((game) => game.id === "terraria")!;
  assert.equal(terraria.workshop?.appId, 105600);
  assert.ok(GAMES.every((game) => !game.workshop || game.modSource === WORKSHOP_SOURCE), "workshop games label their mod source");
});

test("collection payloads: ordered children, nested collections skipped, failures null", () => {
  const body = collectionRequestBody("424242");
  assert.equal(body.get("collectioncount"), "1");
  assert.equal(body.get("publishedfileids[0]"), "424242");

  const children = mapCollectionChildren({
    result: 1,
    children: [
      { publishedfileid: "30", sortorder: 2, filetype: 0 },
      { publishedfileid: "10", sortorder: 0, filetype: 0 },
      { publishedfileid: "99", sortorder: 1, filetype: 2 }, // nested collection — skipped
      { publishedfileid: "oops", sortorder: 3, filetype: 0 },
      { publishedfileid: "20", sortorder: 1, filetype: 0 },
    ],
  });
  assert.deepEqual(children, ["10", "20", "30"], "collection order kept, junk and nesting dropped");
  assert.equal(mapCollectionChildren({ result: 9 }), null, "not-a-collection maps to null");
  assert.deepEqual(mapCollectionChildren({ result: 1 }), [], "a collection with no children is empty, not null");
});

test("wiring pins: routes, mods page, nav", () => {
  const route = fs.readFileSync("src/app/api/servers/[id]/workshop/route.ts", "utf8");
  assert.ok(route.includes("consumerAppId !== workshop.appId"), "items for other games are refused");
  assert.ok(route.includes("WORKSHOP_SOURCE"), "rows carry the Workshop source marker");
  const updates = fs.readFileSync("src/app/api/servers/[id]/workshop/updates/route.ts", "utf8");
  assert.ok(updates.includes("workshopUpdateStatus"));
  assert.ok(updates.includes("export async function POST"), "updates can be acknowledged (re-stamp)");
  const collection = fs.readFileSync("src/app/api/servers/[id]/workshop/collection/route.ts", "utf8");
  assert.ok(collection.includes("fetchCollectionChildren") && collection.includes("COLLECTION_CAP"), "collection import is capped");
  assert.ok(collection.includes("consumerAppId !== workshop.appId"), "collection children for other games are skipped");
  const page = fs.readFileSync("src/app/servers/[id]/mods/page.tsx", "utf8");
  assert.ok(page.includes("WorkshopManager") && page.indexOf("g.workshop") < page.indexOf("redirect(`/servers"), "workshop games render the manager instead of redirecting");
  const frame = fs.readFileSync("src/components/server-frame.tsx", "utf8");
  assert.ok(frame.includes("game.supportsMods || game.workshop"), "nav shows the tab for workshop games");
  console.log("WORKSHOP_SUITE_OK");
});
