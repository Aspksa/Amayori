// Export explicitly reviewed training examples; never mine private chat archives automatically.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export function validateExample(example){
 if(!example||typeof example!=='object'||example.approved!==true)throw Error('Example requires approved=true');
 const {instruction,response}=example;
 if(typeof instruction!=='string'||typeof response!=='string'||!instruction.trim()||!response.trim())throw Error('Instruction and response required');
 if(instruction.length>8000||response.length>12000)throw Error('Example too large');
 const secrets=/(?:sk-[a-zA-Z0-9_-]{16,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:api[_-]?key|password|token)\s*[:=]\s*[^\s]{8,})/i;
 if(secrets.test(instruction)||secrets.test(response))throw Error('Potential secret detected');
 return {messages:[{role:'user',content:instruction.trim()},{role:'assistant',content:response.trim()}]};
}
export async function exportDataset(source,destination){
 if(path.resolve(source)===path.resolve(destination))throw Error('Source and destination must differ');
 const input=JSON.parse(await fs.readFile(source,'utf8'));
 if(!Array.isArray(input)||input.length===0||input.length>10000)throw Error('Expected 1..10000 reviewed examples');
 const output=input.map(validateExample).map(x=>JSON.stringify(x)).join('\n')+'\n';
 await fs.mkdir(path.dirname(path.resolve(destination)),{recursive:true});
 await fs.writeFile(destination,output,{flag:'wx',mode:0o600});
 return input.length;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [source,destination]=process.argv.slice(2);
 if(!source||!destination){console.error('Usage: node scripts/export-reviewed-dataset.mjs reviewed.json output.jsonl');process.exitCode=2}
 else exportDataset(source,destination).then(n=>console.log('Exported approved examples:',n)).catch(e=>{console.error(e.message);process.exitCode=1});
}
