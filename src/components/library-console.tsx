'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';

type Role = 'admin'|'manager'|'inputer'|'user';
type Identity = {id:number;username:string;role:Role};
type Book = {id:number;isbn:string|null;title:string;author:string;category:string;publisher:string;publication_year:number|null;copies_total:number;copies_available:number};
type Member = {id:number;member_code:string;full_name:string;email:string;phone:string;active:number;active_loans:number};
type Loan = {id:number;book_id:number;member_id:number;checked_out_at:string;due_at:string;returned_at:string|null;book_title:string;isbn:string|null;member_code:string;member_name:string;status:'returned'|'overdue'|'on_loan'};
type Account = {id:number;username:string;role:Role;active:number;deleted_at:string|null;created_at:string};
type Settings = {library_name:string;default_loan_days:number;max_active_loans:number};
type ConfigSnapshot = {id:number;label:string;created_at:string;created_by:string|null};
type RowCounts = {users:number;books:number;members:number;loans:number};
type Tab = 'overview'|'catalog'|'members'|'loans'|'staff'|'security';

async function api<T>(path:string, init:RequestInit = {}):Promise<T> {
  const response = await fetch(path, {credentials:'same-origin', ...init,
    headers:{'Content-Type':'application/json', ...(init.headers || {})}});
  const body = await response.json().catch(()=>({})) as {error?:string};
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body as T;
}

function dateAfterDays(days:number) {
  const date = new Date();
  date.setDate(date.getDate()+days);
  return date.toISOString().slice(0,10);
}

function labelRole(role:Role) {
  return role === 'inputer' ? 'Inputer' : role === 'user' ? 'Reader' : role[0].toUpperCase()+role.slice(1);
}

export function LibraryConsole({identity,onSignOut}:{identity:Identity;onSignOut:()=>void}) {
  const isAdmin = identity.role === 'admin';
  const isStaff = identity.role !== 'user';
  const [tab,setTab] = useState<Tab>('overview');
  const [books,setBooks] = useState<Book[]>([]);
  const [members,setMembers] = useState<Member[]>([]);
  const [loans,setLoans] = useState<Loan[]>([]);
  const [accounts,setAccounts] = useState<Account[]>([]);
  const [settings,setSettings] = useState<Settings>({library_name:'Vault of Value Library',default_loan_days:14,max_active_loans:5});
  const [snapshots,setSnapshots] = useState<ConfigSnapshot[]>([]);
  const [rowCounts,setRowCounts] = useState<RowCounts>({users:0,books:0,members:0,loans:0});
  const [events,setEvents] = useState<Array<{actor_id:number|null;action:string;target:string|null;outcome:string;created_at:string}>>([]);
  const [search,setSearch] = useState('');
  const [editingBook,setEditingBook] = useState<Book|null>(null);
  const [editingMember,setEditingMember] = useState<Member|null>(null);
  const [notice,setNotice] = useState('');
  const [error,setError] = useState(false);
  const [busy,setBusy] = useState(false);

  const flash=useCallback((message:string,isError=false)=>{setNotice(message);setError(isError);},[]);
  const load=useCallback(async()=>{
    try {
      const nextBooks=await api<Book[]>('/api/books');
      setBooks(nextBooks);
      setSettings(await api<Settings>('/api/settings'));
      if (isStaff) {
        const [nextMembers,nextLoans]=await Promise.all([api<Member[]>('/api/members'),api<Loan[]>('/api/loans')]);
        setMembers(nextMembers);setLoans(nextLoans);
      }
      if (isAdmin) {
        const [nextAccounts,nextEvents,nextSnapshotInfo]=await Promise.all([api<Account[]>('/api/users'),api<typeof events>('/api/audit'),api<{snapshots:ConfigSnapshot[];counts:RowCounts}>('/api/settings/snapshots')]);
        setAccounts(nextAccounts);setEvents(nextEvents);setSnapshots(nextSnapshotInfo.snapshots);setRowCounts(nextSnapshotInfo.counts);
      }
    } catch (cause) {
      flash(cause instanceof Error?cause.message:'Could not load library data.',true);
    }
  },[flash,isAdmin,isStaff]);

  useEffect(()=>{void load();},[load]);

  async function submit(event:FormEvent<HTMLFormElement>,action:(form:FormData)=>Promise<void>) {
    event.preventDefault();setBusy(true);flash('');
    try { await action(new FormData(event.currentTarget)); }
    catch(cause) { flash(cause instanceof Error?cause.message:'Request failed.',true); }
    finally { setBusy(false); }
  }

  async function saveBook(form:FormData) {
    const payload={isbn:form.get('isbn'),title:form.get('title'),author:form.get('author'),category:form.get('category'),publisher:form.get('publisher'),publication_year:form.get('publication_year'),copies_total:form.get('copies_total')};
    if(editingBook) await api(`/api/books/${editingBook.id}`,{method:'PATCH',body:JSON.stringify(payload)});
    else await api('/api/books',{method:'POST',body:JSON.stringify(payload)});
    setEditingBook(null);flash(editingBook?'Book updated.':'Book added to the catalogue.');await load();
  }

  async function deleteBook(book:Book) {
    if(!window.confirm(`Delete “${book.title}” from the catalogue?`))return;
    try { await api(`/api/books/${book.id}`,{method:'DELETE'});flash('Book deleted.');await load(); }
    catch(cause) { flash(cause instanceof Error?cause.message:'Could not delete book.',true); }
  }

  async function saveMember(form:FormData) {
    const payload={member_code:form.get('member_code'),full_name:form.get('full_name'),email:form.get('email'),phone:form.get('phone'),active:form.get('active')==='true'};
    if(editingMember) await api(`/api/members/${editingMember.id}`,{method:'PATCH',body:JSON.stringify(payload)});
    else await api('/api/members',{method:'POST',body:JSON.stringify(payload)});
    setEditingMember(null);flash(editingMember?'Member updated.':'Member registered.');await load();
  }

  async function checkout(form:FormData) {
    await api('/api/loans',{method:'POST',body:JSON.stringify({book_id:form.get('book_id'),member_id:form.get('member_id'),due_at:form.get('due_at')})});
    flash('Book checked out.');await load();
  }

  async function returnBook(loan:Loan) {
    try { await api(`/api/loans/${loan.id}/return`,{method:'POST'});flash('Book returned.');await load(); }
    catch(cause) { flash(cause instanceof Error?cause.message:'Could not return book.',true); }
  }

  async function createStaff(form:FormData) {
    await api('/api/users',{method:'POST',body:JSON.stringify({username:form.get('username'),password:form.get('password'),role:form.get('role')})});
    flash('Account created. The user will set up MFA on first sign-in.');await load();
  }

  async function saveSettings(form:FormData) {
    const next=await api<Settings>('/api/settings',{method:'PUT',body:JSON.stringify({library_name:form.get('library_name'),default_loan_days:Number(form.get('default_loan_days')),max_active_loans:Number(form.get('max_active_loans'))})});
    setSettings(next);flash('Library settings saved.');await load();
  }

  async function createConfigSnapshot() {
    try { await api('/api/settings/snapshots',{method:'POST',body:JSON.stringify({label:`Configuration ${new Date().toLocaleString()}`})});flash('Configuration restore point created.');await load(); }
    catch(cause) { flash(cause instanceof Error?cause.message:'Could not create restore point.',true); }
  }

  async function restoreConfigSnapshot(snapshot:ConfigSnapshot) {
    if(!window.confirm(`Restore “${snapshot.label}”? This changes configuration only; it does not restore or change books, members, loans, or accounts.`))return;
    try { const result=await api<{message:string}>(`/api/settings/snapshots/${snapshot.id}/restore`,{method:'POST'});setNotice(result.message);setError(false);await load(); }
    catch(cause) { flash(cause instanceof Error?cause.message:'Could not restore settings.',true); }
  }

  async function downloadBackup() {
    try {
      const response=await fetch('/api/admin/backup',{credentials:'same-origin'});
      if(!response.ok){const body=await response.json().catch(()=>({error:'Could not create backup.'}));throw new Error(body.error||'Could not create backup.');}
      const blob=await response.blob();const url=URL.createObjectURL(blob);const link=document.createElement('a');
      link.href=url;link.download=`library-backup-${new Date().toISOString().slice(0,10)}.json`;link.click();URL.revokeObjectURL(url);
      flash('Encrypted backup downloaded. Store the file and BACKUP_ENCRYPTION_KEY separately.');
    } catch(cause) { flash(cause instanceof Error?cause.message:'Could not create backup.',true); }
  }

  async function restoreDataBackup(event:ChangeEvent<HTMLInputElement>) {
    const file=event.currentTarget.files?.[0];event.currentTarget.value='';
    if(!file)return;
    if(file.size>16_000_000){flash('Backup file is too large.',true);return;}
    try {
      const backup=JSON.parse(await file.text()) as unknown;
      if(!window.confirm('This will replace the current accounts, catalogue, members, loans, settings, and audit history with the encrypted backup. All sessions will be signed out. Continue?'))return;
      const result=await api<{message:string}>('/api/admin/backup',{method:'POST',body:JSON.stringify({confirmation:'RESTORE',backup})});
      flash(result.message);window.setTimeout(()=>window.location.reload(),1800);
    } catch(cause) { flash(cause instanceof Error?cause.message:'Could not restore this backup.',true); }
  }

  async function changeRole(account:Account,role:Role) {
    try { await api(`/api/users/${account.id}/role`,{method:'PATCH',body:JSON.stringify({role})});flash('Staff role updated.');await load(); }
    catch(cause) { flash(cause instanceof Error?cause.message:'Could not change role.',true); }
  }

  async function toggleAccount(account:Account) {
    try { await api(`/api/users/${account.id}/active`,{method:'PATCH'});flash('Account status updated.');await load(); }
    catch(cause) { flash(cause instanceof Error?cause.message:'Could not change account status.',true); }
  }

  async function deleteAccount(account:Account) {
    if(!window.confirm(`Mark ${account.username} as deleted? The account row and history will be retained, and an admin can restore it later.`))return;
    try { await api(`/api/users/${account.id}`,{method:'DELETE'});flash('Account marked deleted; its record was retained.');await load(); }
    catch(cause) { flash(cause instanceof Error?cause.message:'Could not delete account.',true); }
  }

  async function changePassword(form:FormData) {
    const result=await api<{message:string}>('/api/auth/password',{method:'POST',body:JSON.stringify({currentPassword:form.get('currentPassword'),newPassword:form.get('newPassword'),code:form.get('code')})});
    flash(result.message);(document.querySelector('#password-form') as HTMLFormElement|null)?.reset();
  }

  const filteredBooks=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return q?books.filter(book=>[book.title,book.author,book.category,book.isbn||''].some(value=>value.toLowerCase().includes(q))):books;
  },[books,search]);
  const activeLoans=loans.filter(loan=>loan.status!=='returned');
  const overdue=activeLoans.filter(loan=>loan.status==='overdue').length;
  const tabs: Array<{id:Tab;name:string}>=[{id:'overview',name:'Overview'},{id:'catalog',name:'Catalogue'},...(isStaff?[{id:'members' as Tab,name:'Members'},{id:'loans' as Tab,name:'Loans'}]:[]),...(isAdmin?[{id:'staff' as Tab,name:'Admin'}]:[]),{id:'security',name:'Security'}];

  return <div className="library-shell">
    {notice&&<div className={`notice ${error?'notice-error':''}`} role={error?'alert':'status'}>{notice}</div>}
    <section className="welcome-card library-welcome"><div><div className="section-kicker">{settings.library_name.toUpperCase()}</div><h2>Good to see you, {identity.username}</h2><p className="muted">Signed in as <span className={`role-chip role-${identity.role}`}>{labelRole(identity.role)}</span></p></div><button className="quiet-button" onClick={onSignOut}>Sign out</button></section>
    <nav className="library-tabs" aria-label="Library sections">{tabs.map(item=><button key={item.id} className={tab===item.id?'active':''} onClick={()=>{setTab(item.id);setEditingBook(null);setEditingMember(null);}}>{item.name}</button>)}</nav>

    {tab==='overview'&&<>
      <div className="library-metrics"><article><span>Titles in catalogue</span><b>{books.length}</b><small>Distinct book records</small></article><article><span>Copies available</span><b>{books.reduce((sum,book)=>sum+book.copies_available,0)}</b><small>Ready to borrow</small></article>{isStaff&&<><article><span>Books on loan</span><b>{activeLoans.length}</b><small>Currently checked out</small></article><article><span>Overdue</span><b className={overdue?'metric-alert':''}>{overdue}</b><small>Past due date</small></article></>}</div>
      <section className="content-card"><div className="card-heading"><div><div className="section-kicker">QUICK LOOK</div><h3>Recently added books</h3></div><button className="mini-button" onClick={()=>setTab('catalog')}>Open catalogue</button></div>
        <div className="book-grid">{books.slice(0,4).map(book=><article className="book-tile" key={book.id}><span className="book-cover" aria-hidden="true">▤</span><div><span className="book-category">{book.category}</span><h4>{book.title}</h4><p>{book.author}</p><small>{book.copies_available} of {book.copies_total} available</small></div></article>)}{books.length===0&&<p className="empty-state">No books yet. Add the first title in the catalogue.</p>}</div>
      </section>
    </>}

    {tab==='catalog'&&<>
      {isStaff&&<section className="content-card"><div className="card-heading"><div><div className="section-kicker">COLLECTION</div><h3>{editingBook?'Edit book details':'Add a book'}</h3></div><span className="small-tag">{isAdmin?'Admin access':identity.role==='manager'?'Manager access':'Inputer access'}</span></div>
        <form key={editingBook?.id??'new-book'} className="library-form" onSubmit={event=>void submit(event,saveBook)}><label>Title<input name="title" required maxLength={200} defaultValue={editingBook?.title||''}/></label><label>Author<input name="author" required maxLength={160} defaultValue={editingBook?.author||''}/></label><label>ISBN<input name="isbn" maxLength={32} defaultValue={editingBook?.isbn||''}/></label><label>Category<input name="category" maxLength={80} defaultValue={editingBook?.category||'General'}/></label><label>Publisher<input name="publisher" maxLength={160} defaultValue={editingBook?.publisher||''}/></label><label>Year<input name="publication_year" type="number" min="1000" max="2200" defaultValue={editingBook?.publication_year||''}/></label><label>Total copies<input name="copies_total" type="number" min="0" max="10000" required defaultValue={editingBook?.copies_total??1}/></label><div className="form-actions"><button className="primary" disabled={busy}>{editingBook?'Save changes':'Add book'}</button>{editingBook&&<button type="button" className="quiet-button" onClick={()=>setEditingBook(null)}>Cancel</button>}</div></form>
      </section>}
      <section className="content-card"><div className="card-heading"><div><div className="section-kicker">SEARCH & DISCOVER</div><h3>Book catalogue</h3></div><span className="count-tag">{filteredBooks.length} titles</span></div><input className="table-search" aria-label="Search catalogue" placeholder="Search by title, author, ISBN or category" value={search} onChange={event=>setSearch(event.target.value)}/>
        <div className="table-scroll"><table><thead><tr><th>TITLE</th><th>AUTHOR</th><th>ISBN / CATEGORY</th><th>AVAILABILITY</th>{isStaff&&<th>ACTIONS</th>}</tr></thead><tbody>{filteredBooks.map(book=><tr key={book.id}><td className="username-cell">{book.title}{book.publication_year&&<small className="table-subline">{book.publisher||'Publisher not listed'} · {book.publication_year}</small>}</td><td>{book.author}</td><td>{book.isbn||'—'}<small className="table-subline">{book.category}</small></td><td><span className={`status ${book.copies_available?'':'status-disabled'}`}><i/>{book.copies_available} / {book.copies_total} available</span></td>{isStaff&&<td className="actions"><button className="mini-button" onClick={()=>{setEditingBook(book);window.scrollTo({top:0,behavior:'smooth'});}}>Edit</button>{isAdmin&&<button className="mini-button danger" onClick={()=>void deleteBook(book)}>Delete</button>}</td>}</tr>)}</tbody></table>{filteredBooks.length===0&&<p className="empty-state">No matching books found.</p>}</div>
      </section>
    </>}

    {tab==='members'&&isStaff&&<>
      <section className="content-card"><div className="card-heading"><div><div className="section-kicker">PATRON RECORDS</div><h3>{editingMember?'Edit member':'Register a member'}</h3></div></div>
        <form key={editingMember?.id??'new-member'} className="library-form" onSubmit={event=>void submit(event,saveMember)}><label>Member number<input name="member_code" required pattern="[A-Za-z0-9-]{2,32}" maxLength={32} defaultValue={editingMember?.member_code||''}/></label><label>Full name<input name="full_name" required maxLength={160} defaultValue={editingMember?.full_name||''}/></label><label>Email<input name="email" type="email" maxLength={254} defaultValue={editingMember?.email||''}/></label><label>Phone<input name="phone" maxLength={40} defaultValue={editingMember?.phone||''}/></label>{editingMember&&<label>Status<select name="active" defaultValue={editingMember.active?'true':'false'}><option value="true">Active</option><option value="false">Inactive</option></select></label>}<div className="form-actions"><button className="primary" disabled={busy}>{editingMember?'Save member':'Register member'}</button>{editingMember&&<button type="button" className="quiet-button" onClick={()=>setEditingMember(null)}>Cancel</button>}</div></form>
      </section>
      <section className="content-card"><div className="card-heading"><div><div className="section-kicker">MEMBERS</div><h3>Member directory</h3></div><span className="count-tag">{members.length} members</span></div><div className="table-scroll"><table><thead><tr><th>MEMBER</th><th>CONTACT</th><th>STATUS</th><th>ACTIVE LOANS</th><th>ACTIONS</th></tr></thead><tbody>{members.map(member=><tr key={member.id}><td className="username-cell">{member.full_name}<small className="table-subline">{member.member_code}</small></td><td>{member.email||'—'}<small className="table-subline">{member.phone||''}</small></td><td><span className={`status ${member.active?'':'status-disabled'}`}><i/>{member.active?'Active':'Inactive'}</span></td><td>{member.active_loans}</td><td><button className="mini-button" onClick={()=>{setEditingMember(member);window.scrollTo({top:0,behavior:'smooth'});}}>Edit</button></td></tr>)}</tbody></table>{members.length===0&&<p className="empty-state">No members registered yet.</p>}</div></section>
    </>}

    {tab==='loans'&&isStaff&&<>
      <section className="content-card"><div className="card-heading"><div><div className="section-kicker">CIRCULATION DESK</div><h3>Check out a book</h3></div><span className="small-tag">Inventory updates automatically</span></div>
        <form key={`checkout-${settings.default_loan_days}`} className="library-form" onSubmit={event=>void submit(event,checkout)}><label>Available book<select name="book_id" required defaultValue=""><option value="" disabled>Select a title</option>{books.filter(book=>book.copies_available>0).map(book=><option key={book.id} value={book.id}>{book.title} ({book.copies_available} available)</option>)}</select></label><label>Active member<select name="member_id" required defaultValue=""><option value="" disabled>Select a member</option>{members.filter(member=>member.active).map(member=><option key={member.id} value={member.id}>{member.full_name} · {member.member_code}</option>)}</select></label><label>Due date<input name="due_at" type="date" min={new Date().toISOString().slice(0,10)} defaultValue={dateAfterDays(settings.default_loan_days)} required/></label><div className="form-actions"><button className="primary" disabled={busy||!books.some(book=>book.copies_available>0)||!members.some(member=>member.active)}>Check out</button></div></form>
      </section>
      <section className="content-card"><div className="card-heading"><div><div className="section-kicker">CIRCULATION HISTORY</div><h3>Loans and returns</h3></div><span className="count-tag">{activeLoans.length} active</span></div><div className="table-scroll"><table><thead><tr><th>BOOK</th><th>MEMBER</th><th>CHECKED OUT</th><th>DUE DATE</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{loans.map(loan=><tr key={loan.id}><td className="username-cell">{loan.book_title}<small className="table-subline">{loan.isbn||'No ISBN'}</small></td><td>{loan.member_name}<small className="table-subline">{loan.member_code}</small></td><td>{new Date(loan.checked_out_at).toLocaleDateString()}</td><td>{new Date(`${loan.due_at}T00:00:00`).toLocaleDateString()}</td><td><span className={`loan-status loan-${loan.status}`}>{loan.status.replace('_',' ')}</span></td><td>{loan.status!=='returned'&&<button className="mini-button" onClick={()=>void returnBook(loan)}>Record return</button>}</td></tr>)}</tbody></table>{loans.length===0&&<p className="empty-state">No books have been checked out yet.</p>}</div></section>
    </>}

    {tab==='staff'&&isAdmin&&<>
      <section className="content-card"><div className="card-heading"><div><div className="section-kicker">USER ACCESS</div><h3>Create an account</h3></div><span className="small-tag">New users set up MFA on their first sign-in</span></div><form className="create-grid" onSubmit={event=>void submit(event,createStaff)}><label>Username<input name="username" required minLength={3} maxLength={64} pattern="[A-Za-z0-9_.-]+"/></label><label>Temporary password <small>At least 12 characters</small><input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={256}/></label><label>Role<select name="role" defaultValue="inputer"><option value="admin">Admin</option><option value="manager">Manager</option><option value="inputer">Inputer</option><option value="user">Reader</option></select></label><button className="primary" disabled={busy}>Create account</button></form></section>
      <section className="content-card"><div className="card-heading"><div><div className="section-kicker">ACCOUNT CONTROL</div><h3>All account records</h3></div><span className="count-tag">{accounts.length} accounts</span></div><div className="table-scroll"><table><thead><tr><th>USERNAME</th><th>ROLE</th><th>STATUS</th><th>CREATED</th><th>ACTIONS</th></tr></thead><tbody>{accounts.map(account=><tr key={account.id}><td className="username-cell">{account.username}</td><td><select aria-label={`Role for ${account.username}`} value={account.role} disabled={account.id===identity.id||Boolean(account.deleted_at)} onChange={event=>void changeRole(account,event.target.value as Role)}><option value="user">Reader</option><option value="inputer">Inputer</option><option value="manager">Manager</option><option value="admin">Admin</option></select></td><td><span className={`status ${account.active&&!account.deleted_at?'':'status-disabled'}`}><i/>{account.deleted_at?'Deleted':account.active?'Active':'Disabled'}</span></td><td>{new Date(account.created_at).toLocaleDateString()}</td><td className="actions">{account.id!==identity.id&&<><button className="mini-button" onClick={()=>void toggleAccount(account)}>{account.deleted_at?'Restore':account.active?'Disable':'Enable'}</button>{!account.deleted_at&&<button className="mini-button danger" onClick={()=>void deleteAccount(account)}>Mark deleted</button>}</>}</td></tr>)}</tbody></table></div></section>
      <section className="content-card"><div className="card-heading"><div><div className="section-kicker">SYSTEM SETTINGS</div><h3>Library configuration</h3></div><span className="small-tag">Configuration changes do not modify catalogue records</span></div><form key={`${settings.library_name}:${settings.default_loan_days}:${settings.max_active_loans}`} className="library-form" onSubmit={event=>void submit(event,saveSettings)}><label>Library name<input name="library_name" required maxLength={80} defaultValue={settings.library_name}/></label><label>Default loan period (days)<input name="default_loan_days" type="number" min="1" max="90" required defaultValue={settings.default_loan_days}/></label><label>Maximum active loans per member<input name="max_active_loans" type="number" min="1" max="50" required defaultValue={settings.max_active_loans}/></label><button className="primary" disabled={busy}>Save configuration</button></form></section>
      <section className="content-card"><div className="card-heading"><div><div className="section-kicker">CURRENT DATABASE STATE</div><h3>Rows currently stored</h3></div><span className="small-tag">Live counts · all rows, including deleted accounts</span></div><div className="library-metrics row-counts"><article><span>User records</span><b>{rowCounts.users}</b></article><article><span>Book rows</span><b>{rowCounts.books}</b></article><article><span>Member rows</span><b>{rowCounts.members}</b></article><article><span>Loan rows</span><b>{rowCounts.loans}</b></article></div></section>
      <section className="content-card"><div className="card-heading"><div><div className="section-kicker">CONFIGURATION RESTORE POINTS</div><h3>Save or restore settings</h3><p className="muted">A restore point stores settings only. Restoring it never changes books, members, loans, or user accounts.</p></div><button className="primary" onClick={()=>void createConfigSnapshot()}>Save restore point</button></div><div className="table-scroll"><table><thead><tr><th>LABEL</th><th>CREATED BY</th><th>DATE</th><th>ACTION</th></tr></thead><tbody>{snapshots.map(snapshot=><tr key={snapshot.id}><td>{snapshot.label}</td><td>{snapshot.created_by||'System'}</td><td>{new Date(snapshot.created_at).toLocaleString()}</td><td><button className="mini-button" onClick={()=>void restoreConfigSnapshot(snapshot)}>Restore settings</button></td></tr>)}</tbody></table>{snapshots.length===0&&<p className="empty-state">No configuration restore points yet.</p>}</div></section>
      <section className="content-card"><div className="card-heading"><div><div className="section-kicker">ENCRYPTED DATABASE BACKUP</div><h3>Export or restore the full system</h3><p className="muted">Backups include account hashes, MFA ciphertext, library records, settings, and audit history. The file is encrypted before download.</p></div></div><div className="form-actions"><button className="primary" onClick={()=>void downloadBackup()}>Download encrypted backup</button><label className="mini-button file-restore">Choose backup to restore<input type="file" accept="application/json,.json" onChange={event=>void restoreDataBackup(event)}/></label></div><p className="muted">Restoring replaces current database records and signs out all sessions. The backup and the same BACKUP_ENCRYPTION_KEY, AUTH_PEPPER, and MFA_ENCRYPTION_KEY are needed to recover accounts.</p></section>
      <section className="content-card"><div className="card-heading"><div><div className="section-kicker">AUDIT</div><h3>Recent security and library events</h3></div><span className="small-tag">Latest 200</span></div><div className="table-scroll"><table><thead><tr><th>TIME</th><th>ACTOR</th><th>EVENT</th><th>TARGET</th><th>RESULT</th></tr></thead><tbody>{events.map((event,index)=><tr key={`${event.created_at}-${index}`}><td>{new Date(event.created_at).toLocaleString()}</td><td>{event.actor_id??'—'}</td><td>{event.action}</td><td>{event.target??'—'}</td><td>{event.outcome}</td></tr>)}</tbody></table></div></section>
    </>}

    {tab==='security'&&<>
      <section className="content-card"><div className="card-heading"><div><div className="section-kicker">PERSONAL SECURITY</div><h3>Change your password</h3></div><span className="small-tag">MFA required</span></div><form id="password-form" className="password-grid" onSubmit={event=>void submit(event,changePassword)}><label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required/></label><label>New password <small>At least 12 characters</small><input name="newPassword" type="password" autoComplete="new-password" required minLength={12}/></label><label>Authenticator or recovery code<input name="code" autoComplete="one-time-code" inputMode="numeric" required/></label><button className="primary" disabled={busy}>Update password</button></form></section>
      <section className="content-card role-guide"><div className="section-kicker">ACCESS MODEL</div><h3>Your role: {labelRole(identity.role)}</h3><p>Administrators control staff accounts and deletions. Managers oversee the catalogue, members and circulation. Inputers handle routine book, member and loan entries. Reader accounts can search the catalogue.</p></section>
    </>}

  </div>;
}
