const {execFileSync}=require('node:child_process');
const files=require('./public-files.cjs').filter(name=>name.startsWith('scripts/')&&name.endsWith('.js'));
for(const file of files)execFileSync(process.execPath,['--check',file],{stdio:'inherit'});
console.log(`Syntax checked: ${files.length} application scripts`);
