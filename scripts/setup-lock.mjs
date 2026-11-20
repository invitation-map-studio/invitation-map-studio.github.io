import {randomBytes,pbkdf2Sync} from 'node:crypto'
import {createInterface} from 'node:readline/promises'
import {Writable} from 'node:stream'
// Only the salt and derived verifier may reach output, including in redirected CI logs.
if(!process.stdin.isTTY)throw Error('대화형 터미널에서 실행해 주세요.')
const secretOut=new Writable({write(_chunk,_enc,done){done()}})
const input=createInterface({input:process.stdin,output:secretOut,terminal:true})
try{
  process.stderr.write('작업실 전용 이용 문구 (12~128자, 입력 숨김): ')
  const phrase=await input.question('')
  if(phrase.length<12||phrase.length>128)throw Error('문구 길이를 확인해 주세요.')
  const salt=randomBytes(16),hash=pbkdf2Sync(phrase,salt,600000,32,'sha256')
  console.log('\nVITE_LOCK_VERIFIER=v1.600000.'+salt.toString('hex')+'.'+hash.toString('hex'))
}finally{input.close()}
