import assert from "node:assert/strict";
import { parseA2sPlayers } from "../src/lib/query-protocols";
const entry=(index:number,name:string,score:number,duration:number)=>{const numbers=Buffer.alloc(8);numbers.writeInt32LE(score,0);numbers.writeFloatLE(duration,4);return Buffer.concat([Buffer.from([index]),Buffer.from(name+"\0"),numbers])};
const packet=Buffer.concat([Buffer.from([255,255,255,255,0x44,2]),entry(0,"Ahri",42,125.5),entry(1,"Poro",-2,12)]);
const players=parseA2sPlayers(packet);assert.equal(players.length,2);assert.deepEqual(players[0],{index:0,name:"Ahri",score:42,durationSeconds:125.5});assert.equal(players[1].score,-2);assert.throws(()=>parseA2sPlayers(packet.subarray(0,10)));console.log("A2S_PLAYER_PARSER_REGRESSION_OK");
