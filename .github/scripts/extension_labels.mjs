const identifier=/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const references=text=>[...String(text||'').matchAll(/\b[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+\b/g)].map(m=>m[0]);

export function decideExtensionLabels({pr,files,labels}){
  const mapping=new Map();
  const extensionLabels=labels.filter(l=>l.name.startsWith('ext-'));
  for(const label of extensionLabels){
    const match=/^\s*([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+)\s+(?:developer\s+)?extension(?:\s|$)/.exec(label.description||'');
    if(match){const names=mapping.get(match[1])||[];names.push(label.name);mapping.set(match[1],names);}
  }
  const ids=new Set(references(pr.title+'\n'+(pr.body||'')));
  let extensionFiles=false,docChanges=false,unknownFolder=false;
  for(const file of files){
    if(file.filename.startsWith('cli/azd/extensions/')){
      extensionFiles=true;
      const folder=file.filename.slice('cli/azd/extensions/'.length).split('/');
      if(folder.length>1&&identifier.test(folder[0]))ids.add(folder[0]);else unknownFolder=true;
    }
    if(file.filename.startsWith('cli/azd/docs/')||/\.(md|mdx|rst)$/i.test(file.filename)){
      docChanges=true;
      for(const id of references(file.patch))ids.add(id);
    }
  }
  const matched=[...new Set([...ids].flatMap(id=>mapping.get(id)||[]))].sort();
  const unresolved=[...ids].filter(id=>!mapping.has(id)).sort();
  let semanticRemaining=docChanges||unknownFolder||unresolved.length>0;
  if(extensionFiles&&extensionLabels.length===0&&labels.some(l=>l.name==='area/extensions')){
    matched.push('area/extensions');semanticRemaining=false;
  }
  const existing=new Set((pr.labels||[]).map(l=>l.name.toLowerCase()));
  return{scope:'Exact extension IDs and explicit label descriptions; qualitative topic association remains outside this deterministic component',candidate_ids:[...ids].sort(),matched_labels:matched,add_labels:matched.filter(name=>!existing.has(name.toLowerCase())),semantic_remaining:semanticRemaining,unmapped_ids:unresolved,has_doc_changes:docChanges,extension_related:extensionFiles||docChanges||ids.size>0};
}

export async function runExtensionLabels({github,context,prNumber,checkpoint=()=>{}}){
  const {owner,repo}=context.repo;
  if(`${owner}/${repo}`!=='mohanad-hafez/azd-extension-checks')throw Error('Unexpected repository');
  if(context.actor!=='mohanad-hafez')throw Error('Experimental invocation must be by the repository owner');
  if(!Number.isSafeInteger(prNumber)||prNumber<1)throw Error('Invalid pull request');
  const {data:pr}=await github.rest.pulls.get({owner,repo,pull_number:prNumber});
  if(pr.state!=='open')throw Error('Pull request is not open');
  const files=await github.paginate(github.rest.pulls.listFiles,{owner,repo,pull_number:prNumber,per_page:100});
  if(files.length!==pr.changed_files)throw Error('Incomplete changed-file list');
  const labels=await github.paginate(github.rest.issues.listLabelsForRepo,{owner,repo,per_page:100});
  const plan=decideExtensionLabels({pr,files,labels});
  const result={task:'extension_labels',model_calls:0,pr:prNumber,head_sha:pr.head.sha,inputs:{pr,files,labels},plan,operations:[],status:'planned'};checkpoint(result);
  const {data:fresh}=await github.rest.pulls.get({owner,repo,pull_number:prNumber});
  if(fresh.state!=='open'||fresh.head.sha!==pr.head.sha)throw Error('Pull request changed after capture');
  const existing=new Set(fresh.labels.map(l=>l.name.toLowerCase()));
  const pending=plan.add_labels.filter(name=>!existing.has(name.toLowerCase()));
  for(let start=0;start<pending.length;start+=10){
    const batch=pending.slice(start,start+10),operation={labels:batch,status:'request_started'};
    result.operations.push(operation);checkpoint(result);
    try{await github.rest.issues.addLabels({owner,repo,issue_number:prNumber,labels:batch});operation.status='response_received';checkpoint(result);}
    catch(error){operation.status='delivery_uncertain_requires_inspection';checkpoint(result);throw error;}
  }
  const observed=await github.paginate(github.rest.issues.listLabelsOnIssue,{owner,repo,issue_number:prNumber,per_page:100});
  if(plan.matched_labels.some(name=>!observed.some(l=>l.name.toLowerCase()===name.toLowerCase())))throw Error('Label readback mismatch');
  result.observed_labels=observed.map(l=>l.name);
  result.status=plan.semantic_remaining?(pending.length?'verified_partial_labels_semantic_remaining':'needs_semantic_association'):(pending.length?'verified_labels_applied':'verified_noop');
  checkpoint(result);return result;
}
