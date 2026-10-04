import {authHeaders} from './auth';
import {API_BASE_URL} from './config';
export async function api<T>(path:string,method='GET',body?:unknown):Promise<T>{
 let response:Response;
 try{response=await fetch(`${API_BASE_URL}${path}`,{method,headers:{...authHeaders(),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});}catch{throw new Error('Cannot reach the server. Check your connection and try again.');}
 const result=await response.json().catch(()=>null);
 if(!response.ok)throw new Error(typeof result?.detail==='string'?result.detail:response.status===403?'You do not have permission for this action.':'Could not save. Check the required fields and try again.');
 return result as T;
}
