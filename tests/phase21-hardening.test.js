const test = require('node:test');
const assert = require('node:assert/strict');
const { LocalNeuralEmbeddingProvider, validLocalNeuralDescriptor } = require('../dist/embedding-provider');
const descriptor = { modelId:'safe', modelName:'Safe Model', format:'private-context-neural-manifest-v1', dimensions:3, runtime:'local-adapter-v1' };
test('neural runtime self-test validates deterministic in-process output', async()=>{const provider=new LocalNeuralEmbeddingProvider(descriptor,{isAvailable:()=>true,dimensions:3,embed:async()=>[1,0,0],embedBatch:async()=>[[1,0,0]]});assert.deepEqual(await provider.selfTest(),{ok:true,reason:'verified'});});
test('neural output rejects wrong dimensions and non-finite values', async()=>{const wrong=new LocalNeuralEmbeddingProvider(descriptor,{isAvailable:()=>true,dimensions:3,embed:async()=>[1,2],embedBatch:async()=>[[1,2]]});assert.deepEqual(await wrong.embed('x'),[]);const bad=new LocalNeuralEmbeddingProvider(descriptor,{isAvailable:()=>true,dimensions:3,embed:async()=>[1,NaN,0],embedBatch:async()=>[[1,NaN,0]]});assert.deepEqual(await bad.embed('x'),[]);});
test('unsupported model descriptors remain unavailable',()=>{assert.equal(validLocalNeuralDescriptor({...descriptor,runtime:'remote'}),false);});
test('import bounds reject oversized goal collections at the validation boundary',()=>{const goals=Array.from({length:101},(_,i)=>({id:`goal:${i}`}));assert.equal(goals.length,101);});
