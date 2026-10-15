"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/features/catalog/use-action";
import { beginTelegramLinkAction, unlinkTelegramAction } from "@/server/commands/lead-routing";

export function TelegramLink({linkedAt}:{linkedAt:string | null}) {
  const [link,setLink] = useState<string | null>(null);
  const begin = useAction(beginTelegramLinkAction,{refresh:false,onSuccess:data=>setLink(data.url)});
  const unlink = useAction(unlinkTelegramAction,{onSuccess:()=>setLink(null)});
  return <div className="max-w-xl rounded-lg border bg-card p-5 space-y-4">
    <p role="status">{linkedAt ? "Your Telegram account is linked." : "Your Telegram account is not linked yet."}</p>
    <p className="text-sm text-muted-foreground">Create a private link, open the bot and press Start. The link expires after 10 minutes and works once. Keep it private. Your app role and lead assignment control which progress buttons you can use.</p>
    <Button disabled={begin.pending} onClick={()=>begin.run()}>{begin.pending?"Creating link…":linkedAt?"Link a different Telegram account":"Create my Telegram link"}</Button>
    {link && <p><a className="text-sm underline" href={link} rel="noreferrer" target="_blank">Open @tileconcept_leads_bot and press Start</a></p>}
    {linkedAt && <Button variant="outline" disabled={unlink.pending} onClick={()=>unlink.run()}>Disconnect Telegram</Button>}
    {(begin.error || unlink.error) && <p role="alert" className="text-sm text-destructive">{begin.error || unlink.error}</p>}
    <p className="text-xs text-muted-foreground">After linking in Telegram, reload this page to confirm the connection. Opening WhatsApp does not mark a message as sent; use the explicit progress button after sending it.</p>
  </div>;
}
