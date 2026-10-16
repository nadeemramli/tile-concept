"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DisabledHint } from "@/components/patterns/explain";
import { Field } from "@/components/patterns/field";
import { useAction } from "@/features/catalog/use-action";
import { saveLeadRoutingAction } from "@/server/commands/lead-routing";
import type { RoutingConfig, RoutingState } from "./schema";

type Member = {user_id:string; full_name:string | null; role_key:string; status:string};
export function RoutingSettings({initial, users}: {initial:RoutingState; users:Member[]}) {
  const [state, setState] = useState(initial);
  const save = useAction(saveLeadRoutingAction, {refresh:false, onSuccess:setState});
  const config = state.config;
  function update(next:RoutingConfig) {setState({...state, config:next});}
  function poolChange(index:number, change:Partial<RoutingConfig["pools"][number]>) {
    update({...config, pools: config.pools.map((p,i) => i===index ? {...p,...change} : p)});
  }
  const activeUsers = users.filter(u => u.status === "active" && ["admin","sales_manager","sales_rep","showroom"].includes(u.role_key));
  return <div className="space-y-5">
    <div className="rounded-lg border bg-card p-4 space-y-2">
      <h2 className="font-semibold">Automatic lead assignment</h2>
      <p className="text-sm text-muted-foreground">Rules apply to new inquiries. Existing owners stay assigned. Unlinked or inactive slots are skipped; if nobody is available, the inquiry stays unassigned for review.</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.enabled} onChange={e => update({...config,enabled:e.target.checked})} /> Enable automatic assignment</label>
    </div>
    {config.pools.map((pool, pi) => <section key={pool.key} className="rounded-lg border bg-card p-4 space-y-3" aria-label={`${pool.name} pool`}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Pool name"><Input aria-label={`Pool ${pi+1} name`} value={pool.name} onChange={e=>poolChange(pi,{name:e.target.value})} /></Field>
        <Field label="Distribution" hint="Fixed uses one salesperson. Equal rotation takes the next eligible person in the displayed order.">
          <select className="h-9 rounded-md border bg-background px-2 text-sm" aria-label={`Pool ${pi+1} distribution`} value={pool.mode} onChange={e=>poolChange(pi,{mode:e.target.value as "fixed"|"round_robin"})}>
            <option value="fixed">Fixed salesperson</option><option value="round_robin">Equal rotation</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`Pool ${pi+1} active`} checked={pool.active} onChange={e=>poolChange(pi,{active:e.target.checked})}/> Pool active</label>
      </div>
      <p className="text-xs text-muted-foreground">Order: {pool.members.map(m=>m.name || "Unnamed slot").join(" → ")}{pool.mode==="round_robin" ? " → repeat" : ""}</p>
      {pool.members.map((member, mi) => {
        function change(patch:Partial<typeof member>) {poolChange(pi,{members:pool.members.map((m,i)=>i===mi ? {...m,...patch}:m)});}
        function move(offset:number) {const members=[...pool.members]; [members[mi],members[mi+offset]]=[members[mi+offset],members[mi]]; poolChange(pi,{members});}
        return <div key={mi} className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <Field label="Salesperson label"><Input aria-label={`${pool.key} slot ${mi+1} name`} value={member.name} onChange={e=>change({name:e.target.value})}/></Field>
          <Field label="App account" hint="Select the real signed-in salesperson. A label alone does not grant account access.">
            <select className="h-9 max-w-64 rounded-md border bg-background px-2 text-sm" aria-label={`${pool.key} slot ${mi+1} account`} value={member.user_id ?? ""} onChange={e=>change({user_id:e.target.value || null})}>
              <option value="">Pending — details needed</option>
              {member.user_id && !activeUsers.some(u=>u.user_id===member.user_id) && <option value={member.user_id}>Unavailable account — choose a replacement</option>}
              {activeUsers.map(u=><option key={u.user_id} value={u.user_id}>{u.full_name || "Unnamed member"}</option>)}
            </select>
          </Field>
          <label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" checked={member.active} aria-label={`${pool.key} slot ${mi+1} active`} onChange={e=>change({active:e.target.checked})}/> Active</label>
          <DisabledHint reason={mi===0 ? "Already first in the pool." : "Move this salesperson earlier in the rotation."}><Button size="icon-sm" variant="outline" aria-label={`Move ${member.name} up`} disabled={mi===0} onClick={()=>move(-1)}><ArrowUp/></Button></DisabledHint>
          <DisabledHint reason={mi===pool.members.length-1 ? "Already last in the pool." : "Move this salesperson later in the rotation."}><Button size="icon-sm" variant="outline" aria-label={`Move ${member.name} down`} disabled={mi===pool.members.length-1} onClick={()=>move(1)}><ArrowDown/></Button></DisabledHint>
          <DisabledHint reason={pool.members.length===1 ? "Keep at least one slot in each pool." : "Remove this slot from future assignments; history stays intact."}><Button size="icon-sm" variant="outline" aria-label={`Remove ${member.name} slot`} disabled={pool.members.length===1} onClick={()=>poolChange(pi,{members:pool.members.filter((_,i)=>i!==mi)})}><X/></Button></DisabledHint>
          {!member.user_id && <span className="text-xs text-muted-foreground">Pending account link</span>}
        </div>;
      })}
      <Button variant="outline" size="sm" disabled={pool.members.length>=30} onClick={()=>poolChange(pi,{members:[...pool.members,{name:"",user_id:null,active:true}]})}><Plus/> Add salesperson slot</Button>
    </section>)}
    <section className="rounded-lg border bg-card p-4 space-y-3" aria-label="Customer type routing">
      <h2 className="font-semibold">Customer type rules</h2>
      <p className="text-sm text-muted-foreground">Match the form answer exactly, ignoring case and surrounding spaces. Separate accepted answers with commas. Unknown answers stay unassigned.</p>
      {config.rules.map((rule, ri) => <div key={ri} className="grid gap-3 sm:grid-cols-3">
        <Field label="Customer type"><Input aria-label={`Rule ${ri+1} customer type`} value={rule.customer_type} onChange={e=>update({...config,rules:config.rules.map((r,i)=>i===ri?{...r,customer_type:e.target.value}:r)})}/></Field>
        <Field label="Assign through"><select className="h-9 rounded-md border bg-background px-2 text-sm" aria-label={`Rule ${ri+1} pool`} value={rule.pool_key ?? ""} onChange={e=>update({...config,rules:config.rules.map((r,i)=>i===ri?{...r,pool_key:e.target.value || null}:r)})}>
          <option value="">Leave unassigned for review</option>{config.pools.map(p=><option key={p.key} value={p.key}>{p.name}</option>)}
        </select></Field>
        <Field label="Accepted form answers"><Input aria-label={`Rule ${ri+1} aliases`} value={rule.aliases.join(",")} onChange={e=>update({...config,rules:config.rules.map((r,i)=>i===ri?{...r,aliases:e.target.value.split(",")}:r)})}/></Field>
      </div>)}
      <Button variant="outline" size="sm" disabled={config.rules.length>=30} onClick={()=>update({...config,rules:[...config.rules,{customer_type:"",pool_key:null,aliases:[""]}]})}>Add customer type rule</Button>
    </section>
    {save.error && <p role="alert" className="text-sm text-destructive">{save.error}</p>}
    <Button disabled={save.pending} onClick={()=>save.run(state)}>{save.pending ? "Saving…" : "Save lead routing"}</Button>
  </div>;
}
