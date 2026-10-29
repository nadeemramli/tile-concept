import { describe,it,expect,vi } from "vitest";
import { completedWindow,fetchMetaSpend } from "@/server/integrations/meta-spend";
const account="123456789";
const info={id:`act_${account}`,currency:"MYR",timezone_name:"Asia/Kuala_Lumpur",account_status:1};
const daily={account_id:account,account_currency:"MYR",date_start:"2026-10-27",date_stop:"2026-10-27",spend:"20.50"};
function mock(...values:unknown[]){return vi.fn<typeof fetch>().mockImplementation(async()=>new Response(JSON.stringify(values.shift()),{status:200}));}
describe("Meta daily reporting",()=>{
 it("uses completed KL days across UTC midnight and month boundaries",()=>{expect(completedWindow(new Date("2026-10-28T16:01:00Z"),7)).toEqual({from:"2026-10-22",to:"2026-10-28"});expect(completedWindow(new Date("2026-01-01T01:00:00Z"),1)).toEqual({from:"2025-12-31",to:"2025-12-31"});});
 it("fills zero days only after a complete report and sends credentials in headers",async()=>{const request=mock(info,{data:[daily]});expect(await fetchMetaSpend("fixture-token",account,"2026-10-27","2026-10-28",request)).toEqual([{day:"2026-10-27",amount:"20.50"},{day:"2026-10-28",amount:"0.00"}]);expect(String(request.mock.calls[1][0])).not.toContain("fixture-token");expect(request.mock.calls[1][1]?.headers).toEqual({Authorization:"Bearer fixture-token"});});
 it("rejects wrong currency, repeated dates, and broken pagination",async()=>{await expect(fetchMetaSpend("fixture",account,"2026-10-27","2026-10-28",mock({...info,currency:"USD"}))).rejects.toThrow();await expect(fetchMetaSpend("fixture",account,"2026-10-27","2026-10-28",mock(info,{data:[daily,daily]}))).rejects.toThrow("Invalid Meta daily report");await expect(fetchMetaSpend("fixture",account,"2026-10-27","2026-10-28",mock(info,{data:[],paging:{next:"https://untrusted.example"}}))).rejects.toThrow("Invalid Meta pagination");});
 it("does not follow provider paging URLs carrying credentials",async()=>{const request=mock(info,{data:[],paging:{next:"https://untrusted.example/?access_token=secret",cursors:{after:"cursor1"}}},{data:[daily]});await fetchMetaSpend("fixture",account,"2026-10-27","2026-10-28",request);expect(String(request.mock.calls[2][0])).toContain("graph.facebook.com/v26.0/");expect(String(request.mock.calls[2][0])).toContain("after=cursor1");});
});
