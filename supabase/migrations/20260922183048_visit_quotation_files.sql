-- Original quotation files are private, immutable attachments to a showroom visit.
create table sales.visit_quotation_files (
  id uuid primary key,
  workspace_id uuid not null references core.workspaces(id),
  visit_id uuid not null references sales.visits(id),
  object_path text not null unique,
  file_name text not null check(length(file_name) between 1 and 255),
  content_type text not null check(content_type in ('application/pdf','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  file_size integer not null check(file_size between 1 and 10485760),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  uploaded_at timestamptz
);
create index visit_quotation_files_visit_idx on sales.visit_quotation_files(visit_id,created_at desc);
alter table sales.visit_quotation_files enable row level security;
create policy visit_quotation_read on sales.visit_quotation_files for select to authenticated using (
  workspace_id=(select core.current_workspace_id())
  and (select core.has_permission('sales.read'))
  and (uploaded_at is not null or created_by=(select auth.uid()))
  and exists(select 1 from sales.visits v where v.id=visit_id and v.workspace_id=visit_quotation_files.workspace_id)
);
grant select on sales.visit_quotation_files to authenticated;
create view api.visit_quotation_files with(security_invoker=true) as select * from sales.visit_quotation_files;
grant select on api.visit_quotation_files to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('visit-quotations','visit-quotations',false,10485760,
  array['application/pdf','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
create policy visit_quotation_upload on storage.objects for insert to authenticated with check (
  bucket_id='visit-quotations' and (select core.has_permission('sales.write'))
  and exists(select 1 from sales.visit_quotation_files f where f.object_path=storage.objects.name
    and f.created_by=(select auth.uid()) and f.uploaded_at is null)
);
create policy visit_quotation_download on storage.objects for select to authenticated using (
  bucket_id='visit-quotations' and exists(select 1 from sales.visit_quotation_files f where f.object_path=storage.objects.name)
);
-- No UPDATE or DELETE storage policies: a new version is a separate attachment.
create function api.visit_quotation_command(p_action text,p_visit_id uuid,p_file_id uuid,p_input jsonb default '{}')
returns text language plpgsql security definer set search_path='' as $$
declare
  v sales.visits%rowtype;
  f sales.visit_quotation_files%rowtype;
  ext text;
  mime text;
  path text;
begin
  perform core.require_permission('sales.write');
  perform core.require_permission('sales.read');
  select * into v from sales.visits where id=p_visit_id and workspace_id=core.current_workspace_id() for update;
  if not found then raise exception 'Visit not found' using errcode='42501'; end if;
  if p_file_id is null then raise exception 'File ID is required' using errcode='23514'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_file_id::text,0));
  select * into f from sales.visit_quotation_files where id=p_file_id for update;
  if found and (f.visit_id<>v.id or f.workspace_id<>v.workspace_id or f.created_by<>auth.uid()) then
    raise exception 'File belongs to another visit or uploader' using errcode='42501';
  end if;
  if p_action='prepare' then
    ext:=lower(substring(p_input->>'file_name' from '\.[^.]+$'));
    mime:=case ext when '.pdf' then 'application/pdf' when '.xls' then 'application/vnd.ms-excel'
      when '.xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' end;
    if mime is null or mime is distinct from p_input->>'content_type'
      or coalesce((p_input->>'file_size')::int,0) not between 1 and 10485760
      or length(btrim(coalesce(p_input->>'file_name',''))) not between 1 and 255
      or p_input->>'file_name' ~ '[[:cntrl:]/\\]' then
      raise exception 'Choose an Excel or PDF file up to 10 MB with a valid filename' using errcode='23514';
    end if;
    if f.id is not null then
      if f.file_name is distinct from p_input->>'file_name' or f.content_type is distinct from mime
        or f.file_size is distinct from (p_input->>'file_size')::int then
        raise exception 'Retry differs from original file' using errcode='23514';
      end if;
      return f.object_path;
    end if;
    path:=v.workspace_id::text||'/'||v.id::text||'/'||p_file_id::text||ext;
    insert into sales.visit_quotation_files(id,workspace_id,visit_id,object_path,file_name,content_type,file_size,created_by)
      values(p_file_id,v.workspace_id,v.id,path,p_input->>'file_name',mime,(p_input->>'file_size')::int,auth.uid());
    return path;
  elsif p_action='finish' then
    if f.id is null then raise exception 'File not found' using errcode='23514'; end if;
    if f.uploaded_at is not null then return f.object_path; end if;
    if not exists(select 1 from storage.objects where bucket_id='visit-quotations' and name=f.object_path
      and (metadata->>'size')::bigint=f.file_size and metadata->>'mimetype'=f.content_type) then
      raise exception 'Upload is incomplete. Select the original file to retry' using errcode='23514';
    end if;
    update sales.visit_quotation_files set uploaded_at=now() where id=f.id;
    perform audit.emit(v.workspace_id,'visit.quotation_uploaded','sales','visit_quotation_files',f.id,null,
      jsonb_build_object('visit_id',v.id,'file_name',f.file_name,'file_size',f.file_size),null);
    return f.object_path;
  end if;
  raise exception 'Unknown quotation action' using errcode='23514';
end $$;
revoke all on function api.visit_quotation_command(text,uuid,uuid,jsonb) from public,anon;
grant execute on function api.visit_quotation_command(text,uuid,uuid,jsonb) to authenticated;
