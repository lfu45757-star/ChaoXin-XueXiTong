import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupDaxue, parseDaxueAnswer, daxueEndpoint } from '../lib/daxue-question-bank.mjs';
import { solveWithLookup } from '../lib/answer-pipeline.mjs';
const question = { id: '1', text: '2+2=?', type: 'single', slots: 0, options: [{key:'A',text:'3'},{key:'B',text:'4'}] };
const hit = {errNo:0,data:{option:'B',answer:'',isAccurate:1,historyResult:'unused'}};
test('搜题酱仅接受 isAccurate=1 与有效选项，不虚构相似度', () => {
  assert.deepEqual(parseDaxueAnswer(question, hit).values, ['B']);
  assert.equal(parseDaxueAnswer(question, hit).matchScore, undefined);
  for (const payload of [{errNo:3,data:hit.data}, {errNo:4002,data:hit.data}, {errNo:0,data:{...hit.data,isAccurate:0}},
    {errNo:0,data:{...hit.data,isAccurate:'1'}}, {errNo:0,data:{...hit.data,option:'Z'}}, {errNo:0,data:{...hit.data,option:''}}])
    assert.equal(parseDaxueAnswer(question,payload),undefined);
});
test('实际multipart协议仅发当前题干/选项，不带cookie、配对密钥或课程身份', async () => {
  let seen;
  const result = await lookupDaxue([question], {fetchImpl:async (url,options)=>{
    seen={url,options};return Response.json(hit);
  }});
  assert.equal(seen.url,daxueEndpoint); assert.equal(seen.options.credentials,'omit');
  assert.equal(seen.options.redirect,'error'); assert.equal(seen.options.headers,undefined);
  assert.equal(seen.options.body.get('questionText'),'2+2=?');
  assert.equal(seen.options.body.get('options'),JSON.stringify(['A. 3','B. 4']));
  assert.equal(seen.options.body.has('courseId'),false); assert.equal(seen.options.body.has('exciseUrl'),false);
  assert.equal(result.answers.length,1);
});
test('登录/额度错误停止后续查题且不重试；搜题酱命中经 AI 核对并保持题目顺序', async () => {
  let calls=0;
  const stopped=await lookupDaxue([question,{...question,id:'2'}],{fetchImpl:async()=>{calls++;return Response.json({errNo:4002});}});
  assert.equal(calls,1);assert.equal(stopped.unavailable,true);
  const result=await solveWithLookup([question,{...question,id:'2'}],{
    lookup:async()=>({answers:[parseDaxueAnswer(question,hit)]}),
    solver:async questions=>{assert.deepEqual(questions.map(q=>q.id),['1','2']);return {answers:questions.map(q=>({id:q.id,values:['B'],confidence:.9,explanation:'fixture'}))};}
  });
  assert.deepEqual(result.answers.map(a=>a.id),['1','2']);
  assert.equal(result.sources[0].provider,'daxuesoutijiang');
  assert.equal(result.sources[0].corroborated,true);
  assert.equal(result.sources[0].matchScore,undefined);assert.equal(result.sources[1].source,'ai');
});
test('搜题酱与 AI 答案冲突时降低置信度，交由二次复核', async () => {
  const result = await solveWithLookup([question], {
    lookup: async () => ({ answers: [parseDaxueAnswer(question, hit)] }),
    solver: async () => ({ answers: [{ id: '1', values: ['A'], confidence: .99, explanation: 'independent check' }] })
  });
  assert.deepEqual(result.answers[0].values, ['A']);
  assert.equal(result.answers[0].confidence, .5);
  assert.equal(result.sources[0].source, 'conflict');
  assert.equal(result.lookup.hits, 0);
});
test('取消查题不启动请求；不合法的多选/填空答案被丢弃', async () => {
  const abort=new AbortController();abort.abort();
  await assert.rejects(lookupDaxue([question],{signal:abort.signal,fetchImpl:()=>{throw Error('must not fetch');}}));
  assert.deepEqual(parseDaxueAnswer({...question,type:'multiple'}, {errNo:0,data:{option:'A、B',isAccurate:1}}).values,['A','B']);
  assert.equal(parseDaxueAnswer({...question,type:'blank',slots:2,options:[]},{errNo:0,data:{option:'only-one',isAccurate:1}}),undefined);
});
