import Link from "next/link";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { PermissionDenied } from "@/components/patterns/states";
import { requireSession } from "@/server/session";
import { getMyTelegramLink } from "@/server/queries/lead-routing";
import { TelegramLink } from "@/features/lead-routing/telegram-link";

export default async function TelegramPage() {
  const session=await requireSession();
  if (!session.permissions.includes("sales.write")) return <PermissionDenied permission="sales.write" roleLabel={session.roleLabel}/>;
  const linkedAt=await getMyTelegramLink();
  return <PageBody><PageHeader title="Connect Telegram" description="Manage assigned Inquiry Box leads from the sales group with your verified identity."/>
    <TelegramLink linkedAt={linkedAt}/><Link href="/sales/inbox" className="text-sm underline">Back to Inquiry Inbox</Link>
  </PageBody>;
}
