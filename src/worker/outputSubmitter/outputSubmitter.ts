import {
  BCS,
  Msg,
  MsgExecute,
  Wallet,
  MnemonicKey,
  LCDClient,
  TxInfo
} from '@initia/initia.js';
import config, { INTERVAL_OUTPUT } from 'config';
import { ExecutorOutputEntity } from 'orm';
import { APIRequest } from 'lib/apiRequest';
import { delay } from 'bluebird';
import { outputLogger as logger } from 'lib/logger';
import { ErrorTypes } from 'lib/error';
import { GetOutputResponse } from 'service';
import * as Bluebird from 'bluebird';

const bcs = BCS.getInstance();

export class OutputSubmitter {
  private submitter: Wallet;
  private apiRequester: APIRequest;
  private syncedHeight = 0;
  private isRunning = false;

  async init() {
    this.submitter = new Wallet(
      config.l1lcd,
      new MnemonicKey({ mnemonic: config.OUTPUT_SUBMITTER_MNEMONIC })
    );
    this.apiRequester = new APIRequest(config.EXECUTOR_URI);
    this.isRunning = true;
  }

  public name(): string {
    return 'output_submitter';
  }

  async getNextBlockHeight(): Promise<number> {
    return await config.l1lcd.move.viewFunction<number>(
      '0x1',
      'op_output',
      'next_block_num',
      [config.L2ID],
      []
    );
  }

  async proposeL2Output(outputRoot: Buffer, l2BlockHeight: number) {
    const executeMsg: Msg = new MsgExecute(
      this.submitter.key.accAddress,
      '0x1',
      'op_output',
      'propose_l2_output',
      [config.L2ID],
      [
        bcs.serialize('vector<u8>', outputRoot, 33),
        bcs.serialize('u64', l2BlockHeight)
      ]
    );
    await sendTx(config.l1lcd, this.submitter, [executeMsg]);
  }

  public async run() {
    await this.init();

    while (this.isRunning) {
      try {
        const nextBlockHeight = await this.getNextBlockHeight();
        logger.info(
          `next block height: ${nextBlockHeight}, synced height: ${this.syncedHeight}`
        );

        if (nextBlockHeight <= this.syncedHeight) continue;

        const res: GetOutputResponse =
          await this.apiRequester.getQuery<GetOutputResponse>(
            `/output/height/${nextBlockHeight}`
          );
        await this.processOutputEntity(res.output, nextBlockHeight);
      } catch (err) {
        if (err.response?.data.type === ErrorTypes.NOT_FOUND_ERROR) {
          this.logWaitingForNextOutput(`not found output from executor height`);
        } else {
          logger.error(err);
          this.stop();
        }
      } finally {
        await Bluebird.Promise.delay(INTERVAL_OUTPUT);
      }
    }
  }

  public async stop() {
    this.isRunning = false;
  }

  private async processOutputEntity(
    outputEntity: ExecutorOutputEntity,
    nextBlockHeight: number
  ) {
    await this.proposeL2Output(
      Buffer.from(outputEntity.outputRoot, 'hex'),
      nextBlockHeight
    );
    this.syncedHeight = nextBlockHeight;
    logger.info(
      `successfully submitted! height: ${nextBlockHeight}, output root: ${outputEntity.outputRoot}`
    );
  }

  private logWaitingForNextOutput(reason?: string) {
    logger.info(`waiting for next output. ${reason}`);
  }
}

/// Utils
async function sendTx(client: LCDClient, sender: Wallet, msg: Msg[]) {
  try {
    const signedTx = await sender.createAndSignTx({ msgs: msg });
    const broadcastResult = await client.tx.broadcast(signedTx);
    await checkTx(client, broadcastResult.txhash);
    return broadcastResult.txhash;
  } catch (error) {
    throw new Error(`Error in sendTx: ${error}`);
  }
}

export async function checkTx(
  lcd: LCDClient,
  txHash: string,
  timeout = 60000
): Promise<TxInfo | undefined> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    try {
      const txInfo = await lcd.tx.txInfo(txHash);
      if (txInfo) return txInfo;
      await delay(1000);
    } catch (err) {
      throw new Error(`Failed to check transaction status: ${err.message}`);
    }
  }

  throw new Error('Transaction checking timed out');
}
