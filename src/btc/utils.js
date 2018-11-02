const bitcoin = require('bitcoinjs-lib');
const btcAddress = require('btc-address');
const binConv = require('binstring');
const crypto = require('crypto');
const secp256k1 = require('secp256k1');
const wanutils = require('wanchain-util');

// const bitcoinRpc = require('node-bitcoin-rpc');

// const btcNode = settings.btcNode;
// const btcNetwork = settings.btcNetwork;
// const bitcoinNetwork = bitcoin.networks[btcNetwork];

// bitcoinRpc.init(btcNode.host, btcNode.port, btcNode.user, btcNode.pass);

module.exports = {
  addressToHash160,
  hash160ToAddress,

  getXHash,
  generateXPair,

  hashForSignature,
  buildHashTimeLockContract,
  buildRedeemTx,
  buildRedeemTxFromWif,

  getTransaction,
}

function hash160ToAddress(hash160, addressType, network) {
  const opts = { in: 'hex', out: 'bytes' };
  const hash = wanutils.stripHexPrefix(hash160);
  const address = new btcAddress(binConv(hash, opts), addressType, network);

  return address.toString();
}

function addressToHash160(addr, addressType, network) {
  const address = new btcAddress(addr, addressType, network);
  return binConv(address.hash, { in: 'bytes', out: 'hex' });
}

function hash256(x) {
  const buff = Buffer.from(wanutils.stripHexPrefix(x), 'hex');
  return bitcoin.crypto.sha256(bitcoin.crypto.sha256(buff)).toString('hex');
}

// convert x to xHash
function getXHash(x) {
  const buff = Buffer.from(wanutils.stripHexPrefix(x), 'hex');
  return bitcoin.crypto.sha256(buff).toString('hex');
}

function generateXPair() {
  let randomBuf;
  do {
    randomBuf = crypto.randomBytes(32);
  } while (!secp256k1.privateKeyVerify(randomBuf));

  const x = randomBuf.toString('hex');
  const xHash = getXHash(x);

  return { x, xHash };
}

// generate the P2SH timelock contract
function buildHashTimeLockContract(network, xHash, lockTimestamp, destH160Addr, revokerH160Addr) {
  const bitcoinNetwork = bitcoin.networks[network];

  const redeemScript = bitcoin.script.compile([

    bitcoin.opcodes.OP_IF,
    bitcoin.opcodes.OP_SHA256,
    Buffer.from(xHash, 'hex'),
    bitcoin.opcodes.OP_EQUALVERIFY,
    bitcoin.opcodes.OP_DUP,
    bitcoin.opcodes.OP_HASH160,
    Buffer.from(wanutils.stripHexPrefix(destH160Addr), 'hex'),

    bitcoin.opcodes.OP_ELSE,
    bitcoin.script.number.encode(lockTimestamp),
    bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
    bitcoin.opcodes.OP_DROP,
    bitcoin.opcodes.OP_DUP,
    bitcoin.opcodes.OP_HASH160,
    Buffer.from(wanutils.stripHexPrefix(revokerH160Addr), 'hex'),
    bitcoin.opcodes.OP_ENDIF,

    bitcoin.opcodes.OP_EQUALVERIFY,
    bitcoin.opcodes.OP_CHECKSIG,
  ]);

  const addressPay = bitcoin.payments.p2sh({
    redeem: { output: redeemScript, network: bitcoinNetwork },
    network: bitcoinNetwork,
  });

  const { address } = addressPay;

  return {
    address,
    redeemScript,
    xHash,
    lockTimestamp
  };
}

function hashForSignature(network, redeemScript, destPublicKey, txid, value) {
  const bitcoinNetwork = bitcoin.networks[network];

  const { address } = bitcoin.payments.p2pkh({
    network: bitcoinNetwork,
    pubkey: new Buffer.from(destPublicKey, 'hex')
  });

  const destH160Addr = bitcoin.crypto.hash160(destPublicKey).toString('hex');
  const txb = new bitcoin.TransactionBuilder(bitcoinNetwork);

  txb.setVersion(1);
  txb.addInput(wanutils.stripHexPrefix(txid), 0);
  txb.addOutput(address, value);

  const tx = txb.buildIncomplete();

  const sigHash = tx.hashForSignature(0, new Buffer.from(redeemScript, 'hex'), bitcoin.Transaction.SIGHASH_ALL);

  return sigHash.toString('hex');
}

function buildRedeemTx(network, redeemScript, signedSigHash, destPublicKey, x, txid, value) {
  const bitcoinNetwork = bitcoin.networks[network];

  // NB: storemen address validation requires that vout is 0
  const vout = 0;

  const { address } = bitcoin.payments.p2pkh({
    network: bitcoinNetwork,
    pubkey: publicKey,
  });

  const destH160Addr = bitcoin.crypto.hash160(destPublicKey).toString('hex');

  const txb = new bitcoin.TransactionBuilder(bitcoinNetwork);

  txb.setVersion(1);
  txb.addInput(wanutils.stripHexPrefix(txid), 0);
  txb.addOutput(address, value);

  const tx = txb.buildIncomplete();

  const signature = bitcoin.script.signature.encode(
    new Buffer.from(signedSigHash, 'base64'),
    bitcoin.Transaction.SIGHASH_ALL
  );

  const redeemScriptSig = bitcoin.payments.p2sh({
    redeem: {
      input: bitcoin.script.compile([
        signature,
        Buffer.from(destPublicKey, 'hex'),
        Buffer.from(x, 'hex'),
        bitcoin.opcodes.OP_TRUE,
      ]),
      output: new Buffer.from(redeemScript, 'hex'),
    },
    network: bitcoinNetwork,
  }).input;

  tx.setInputScript(0, redeemScriptSig);

  return tx.toHex();
}

function buildRedeemTxFromWif(network, redeemScript, destWif, x, txid, value) {
  const bitcoinNetwork = bitcoin.networks[network];

  // NB: storemen address validation requires that vout is 0
  const vout = 0;

  const destKeyPair = bitcoin.ECPair.fromWIF(destWif, bitcoinNetwork);
  const { address } = bitcoin.payments.p2pkh({
    network: bitcoinNetwork,
    pubkey: destKeyPair.publicKey,
  });

  const destH160Addr = bitcoin.crypto.hash160(destKeyPair.publicKey).toString('hex');

  const txb = new bitcoin.TransactionBuilder(bitcoinNetwork);

  txb.setVersion(1);
  txb.addInput(wanutils.stripHexPrefix(txid), 0);
  txb.addOutput(address, value);

  const tx = txb.buildIncomplete();

  const sigHash = tx.hashForSignature(0, new Buffer.from(redeemScript, 'hex'), bitcoin.Transaction.SIGHASH_ALL);
  const signedSigHash = destKeyPair.sign(sigHash);

  const signature = bitcoin.script.signature.encode(
    signedSigHash,
    bitcoin.Transaction.SIGHASH_ALL
  );

  const redeemScriptSig = bitcoin.payments.p2sh({
    redeem: {
      input: bitcoin.script.compile([
        signature,
        destKeyPair.publicKey,
        Buffer.from(x, 'hex'),
        bitcoin.opcodes.OP_TRUE,
      ]),
      output: new Buffer.from(redeemScript, 'hex'),
    },
    network: bitcoinNetwork,
  }).input;

  tx.setInputScript(0, redeemScriptSig);

  return tx.toHex();
}
function getTransaction(txHash) {
  return new Promise((resolve, reject) => {
    bitcoinRpc.call('getrawtransaction', [txHash, 1], (err, res) => {
      if (err !== null) {
        return reject(err);
      }

      // if tx found, return it
      if (res && res.result) {
        return resolve(res.result);
      }

      // otherwise, check the mempool
      bitcoinRpc.call('getrawmempool', [], (err, res) => {
        if (err !== null) {
          return reject(err);
        } else if (res.error !== null) {
          return reject(res.error);
        }

        const transactions = res.result;

        if (! Array.isArray(transactions)) {
          return reject(new Error('mempool transactions is not an array'));
        }

        const tx = transactions.filter(t => t.txid === txHash).shift();

        // if (! tx) return reject(new Error('transaction not found'));
        resolve(tx);
      });
    });
  });
}