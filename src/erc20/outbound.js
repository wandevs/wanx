const BigNumber = require('bignumber.js');

const CrosschainBase = require('../base');
const web3Util = require('../lib/web3');
const types = require('../lib/types');
const hex = require('../lib/hex');

const {
  validateSendOpts,
  validateRedeemOpts,
  validateRevokeOpts,
} = require('./validate');

class ETH_Outbound extends CrosschainBase {

  constructor(config) {
    super(config);
  }

  // complete crosschain transaction
  send(opts) {

    // validate inputs
    opts = validateSendOpts(opts);

    return Promise.resolve([]).then(() => {

      // notify status
      this.emit('info', { status: 'start', redeemKey: opts.redeemKey });

      this.sendApprove(opts);

      return this.getOutboundFee(opts);

    }).then(res => {

      const fee = new BigNumber(res).toString();

      // notify status
      this.emit('info', { status: 'fee', fee });

      return this.sendLock(Object.assign({}, opts, { fee }));

    }).then(receipt => {

      return this.web3eth.eth.getBlockNumber();

    }).then(blockNumber => {

      return this.listenLock(opts, blockNumber);

    }).then(receipt => {

      return this.sendRedeem(opts);

    }).then(receipt => {

      return this.web3wan.eth.getBlockNumber();

    }).then(blockNumber => {

      return this.listenRedeem(opts, blockNumber);

    }).then(receipt => {

      // notify complete
      this.emit('complete', { status: 'complete', receipt });

    }).catch(err => {

      // notify error
      this.emit('error', err)

    });
  }

  // first 1/2 of crosschain transaction
  lock(opts) {

    // validate inputs
    opts = validateSendOpts(opts);

    return Promise.resolve([]).then(() => {

      // notify status
      this.emit('info', { status: 'start', redeemKey: opts.redeemKey });

      this.sendApprove(opts);

      return this.getOutboundFee(opts);

    }).then(res => {

      const fee = new BigNumber(res).toString();

      // notify status
      this.emit('info', { status: 'fee', fee });

      return this.sendLock(Object.assign({}, opts, { fee }));

    }).then(receipt => {

      return this.web3eth.eth.getBlockNumber();

    }).then(blockNumber => {

      return this.listenLock(opts, blockNumber);

    }).then(receipt => {

      // notify complete
      this.emit('complete', {});

    }).catch(err => {

      // notify error
      this.emit('error', err)

    });
  }

  // second 1/2 of crosschain transaction
  // requires redeemKey to be passed in opts
  redeem(opts) {

    // validate inputs
    opts = validateRedeemOpts(opts);

    return Promise.resolve([]).then(() => {

      // notify status
      this.emit('info', { status: 'start', redeemKey: opts.redeemKey });

      return this.sendRedeem(opts);

    }).then(receipt => {

      return this.web3wan.eth.getBlockNumber();

    }).then(blockNumber => {

      return this.listenRedeem(opts, blockNumber);

    }).then(receipt => {

      // notify complete
      this.emit('complete', { status: 'complete', receipt }});

    }).catch(err => {

      // notify error
      this.emit('error', err)

    });
  }

  getOutboundFee(opts) {
    const callOpts = this.buildOutboundFeeTx(opts)
    return this.web3wan.eth.call(callOpts).then(outboundFee => {
      this.emit('info', { status: 'outboundFee', fee: outboundFee });
    });
  }

  // send approve transaction on wanchain
  sendApprove(opts) {
    const sendOpts = this.buildApproveTx(opts);

    return this.web3wan.eth.sendTransaction(sendOpts)
      .on('transactionHash', hash => {
        this.emit('info', { status: 'approveHash', hash });
      })
      .on('receipt', receipt => {
        this.emit('info', { status: 'approved', receipt });
      })
      .on('error', err => {
        this.emit('error', err);
      });
  }

  // send lock transaction on wanchain
  sendLock(opts) {
    const sendOpts = this.buildLockTx(opts);

    return this.web3wan.eth.sendTransaction(sendOpts)
      .on('transactionHash', hash => {
        this.emit('info', { status: 'lockHash', hash });
      })
      .on('receipt', receipt => {
        this.emit('info', { status: 'locking', receipt });
      })
      .on('error', err => {
        this.emit('error', err);
      });
  }

  // listen for storeman tx on ethereum
  listenLock(opts, blockNumber) {
    const lockScanOpts = this.buildLockScanOpts(opts, blockNumber);

    this.emit('info', { status: 'scanLock': params: lockScanOpts });

    return web3Util(this.web3eth).watchLogs(lockScanOpts).then(receipt => {
      this.emit('info', { status: 'locked', receipt });
    });
  }

  // send refund transaction on ethereum
  sendRedeem(opts) {
    const sendOpts = this.buildRedeemTx(opts);

    return this.web3eth.eth.sendTransaction(sendOpts)
      .on('transactionHash', hash => {
        this.emit('info', { status: 'redeemHash', hash });
      })
      .on('receipt', receipt => {
        this.emit('info', { status: 'redeeming', receipt });
      })
      .on('error', err => {
        this.emit('error', err);
      });
  }

  // listen for storeman tx on wanchain
  listenRedeem(opts, blockNumber) {
    const redeemScanOpts = this.buildRedeemScanOpts(opts, blockNumber);

    this.emit('info', { status: 'scanRedeem': params: redeemScanOpts });

    return web3Util(this.web3wan).watchLogs(redeemScanOpts).then(receipt => {
      this.emit('info', { status: 'redeemed', receipt });
    });
  }

  // send revoke transaction on wanchain
  sendRevoke(opts) {
    const sendOpts = this.buildRevokeTx(opts);

    return this.web3wan.eth.sendTransaction(sendOpts)
      .on('transactionHash', hash => {
        this.emit('info', { status: 'revokeHash', hash });
      })
      .on('receipt', receipt => {
        this.emit('info', { status: 'revoked', receipt });
      })
      .on('error', err => {
        this.emit('error', err);
      });
  }

  buildOutboundFeeTx(opts) {
    const to = this.config.wanHtlcAddrE20;
    const data = this.buildOutboundFeeData(opts);

    return { to, data };
  }

  buildApproveTx({ token, from, value }) {
    const approveData = this.buildApproveData({ token, value });

    return {
      Txtype: '0x01',
      from: from,
      to: this.config.wanHtlcAddrE20,
      gas: hex.fromNumber(4700000),
      gasPrice: hex.fromNumber(180e9),
      data: approveData,
    };
  }

  buildLockTx({ token, to, from, value, storeman, redeemKey, fee }) {
    const lockData = this.buildLockData({
      token,
      to,
      value,
      storeman,
      redeemKey,
    });

    return {
      Txtype: '0x01',
      from: from,
      to: this.config.wanHtlcAddrE20,
      gas: hex.fromNumber(4700000),
      gasPrice: hex.fromNumber(180e9),
      value: hex.fromNumber(fee),
      data: lockData,
    };
  }

  buildRedeemTx({ token, to, redeemKey }) {
    const redeemData = this.buildRedeemData({ token, redeemKey });

    return {
      from: to,
      to: this.config.ethHtlcAddrE20,
      gas: hex.fromNumber(4910000),
      gasPrice: hex.fromNumber(100e9),
      data: redeemData,
    };
  }

  buildRevokeTx({ token, from, redeemKey }) {
    const revokeData = this.buildRevokeData({ token, redeemKey });

    return {
      Txtype: '0x01',
      from: from,
      to: this.config.wanHtlcAddrE20,
      gas: hex.fromNumber(4700000),
      gasPrice: hex.fromNumber(180e9),
      data: revokeData,
    };
  }

  buildLockScanOpts({ redeemKey }, blockNumber) {
    return {
      blockNumber,
      address: this.config.ethHtlcAddrE20,
      topics: [
        '0x' + this.config.signatures.HTLCETH_ERC20.OutboundLockLogger,
        null,
        null,
        '0x' + hex.stripPrefix(redeemKey.xHash),
      ],
    };
  }

  buildRedeemScanOpts({ redeemKey }, blockNumber) {
    return {
      blockNumber,
      address: this.config.wanHtlcAddrE20,
      topics: [
        '0x' + this.config.signatures.HTLCWAN_ERC20.OutboundRedeemLogger,
        null,
        null,
        '0x' + hex.stripPrefix(redeemKey.xHash),
      ],
    };
  }

  buildApproveData({ value }) {
    const { approve } = this.config.signatures.ERC20;

    return '0x' + approve.substr(0, 8)
      + types.hex2Bytes32(this.config.wanHtlcAddrE20)
      + types.num2Bytes32(value);
  }

  buildLockData({ token, to, value, storeman, redeemKey }) {
    const { outboundLock } = this.config.signatures.HTLCWAN_ERC20;

    return '0x' + outboundLock.substr(0, 8)
      + types.hex2Bytes32(token)
      + hex.stripPrefix(redeemKey.xHash)
      + types.hex2Bytes32(storeman.wan)
      + types.hex2Bytes32(to)
      + types.num2Bytes32(value);
  }

  buildRedeemData({ token, redeemKey }) {
    const { outboundRedeem } = this.config.signatures.HTLCETH_ERC20;

    return '0x' + outboundRedeem.substr(0, 8)
      + types.hex2Bytes32(token)
      + hex.stripPrefix(redeemKey.x);
  }

  buildRevokeData({ token, redeemKey }) {
    const { outboundRevoke } = this.config.signatures.HTLCWAN_ERC20;

    return '0x' + outboundRevoke.substr(0, 8)
      + types.hex2Bytes32(token)
      + hex.stripPrefix(redeemKey.xHash);
  }

  buildOutboundFeeData({ token, storeman, value }) {
    const { getOutboundFee } = this.config.signatures.HTLCWAN_ERC20;

    return '0x' + getOutboundFee.substr(0, 8)
      + types.hex2Bytes32(token)
      + types.hex2Bytes32(storeman.wan)
      + types.num2Bytes32(value);
  }
}

module.exports = ETH_Outbound;