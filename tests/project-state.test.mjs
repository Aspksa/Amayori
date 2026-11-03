// The roadmap is declared the canonical project map, and it drifted out of date
// twice. A version that disagrees with package.json is now a failing check.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('the project map agrees with the released version',async()=>{
 const pkg=JSON.parse(await readFile('package.json','utf8'));
 const roadmap=JSON.parse(await readFile('docs/amayori-roadmap.json','utf8'));
 assert.equal(roadmap.version,pkg.version,'docs/amayori-roadmap.json отстал от package.json');
 assert.match(roadmap.updated_at,/^\d{4}-\d{2}-\d{2}$/);
 assert.ok(Number.isFinite(Date.parse(roadmap.updated_at)),'updated_at должен быть датой');
 assert.ok(Array.isArray(roadmap.delivered)&&roadmap.delivered.length);
 assert.ok(Array.isArray(roadmap.roadmap)&&roadmap.roadmap.length);
});

test('history lives in the changelog and the readme stays instructions',async()=>{
 const readme=await readFile('README.md','utf8');
 const changelog=await readFile('CHANGELOG.md','utf8');
 assert.match(readme,/CHANGELOG\.md/,'README должен ссылаться на журнал изменений');
 assert.match(changelog,/^## Знания 0\.11/m);
 const versioned=[...readme.matchAll(/^## .*\d+\.\d+/gm)].map(m=>m[0]);
 assert.deepEqual(versioned,[],'разделы с номерами версий должны жить в CHANGELOG.md: '+versioned.join(', '));
});
