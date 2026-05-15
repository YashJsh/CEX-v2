import "dotenv/config";
import { createClient } from "redis";
import { env } from "./utils/env.js";
import { BALANCES, FILLS, ORDERBOOKS, ORDERS, sortedAsks, sortedBids, type Balance, type Fill, type OrderBook, type OrderRecord, type OrderType, type RestingOrder } from "./store/exchange-store.js";
import type { CancelOrder, CreateOrderPayload, GetDepth, GetOrder, GetUserBalance } from "./utils/types.js";
import { uuid } from "uuidv4";
import { symbolName } from "typescript";
import { sortAsks, sortBids } from "./utils/sorted.js";
import { removeAsksFromBook, removeBidFromBook } from "./utils/remove_order_book.js";
import { addAsks, addBids } from "./utils/add_to_book.js";

export type EngineCommandType =
  | "create_order"
  | "get_depth"
  | "get_user_balance"
  | "get_order"
  | "cancel_order"
  | "new_user"
  | "update_balance";

export interface EngineRequest {
  correlationId: string;
  responseQueue: string;
  type: EngineCommandType;
  payload: Record<string, unknown>;
}

export interface EngineResponse {
  correlationId: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

const addOrderBooks = () => {
  console.log("Initializing OrderBooks\n");
  ORDERBOOKS.set("BTC", { asks: new Map(), bids: new Map() });
  ORDERBOOKS.set("USD", { asks: new Map(), bids: new Map() });
  ORDERBOOKS.set("SOL", { asks: new Map(), bids: new Map() });

  console.log("Orderbook Initialized\n", "BTC book : ", ORDERBOOKS.get("BTC"), "USD book : ", ORDERBOOKS.get("USD"), "SOL Book : ", ORDERBOOKS.get("SOL"));
}

addOrderBooks();

const brokerClient = createClient({ url: env.redisUrl }).on("error", (error) => {
  console.error("Redis broker client error", error);
});

const responseClient = createClient({ url: env.redisUrl }).on("error", (error) => {
  console.error("Redis response client error", error);
});

await Promise.all([brokerClient.connect(), responseClient.connect()]);

//ORder matched and updated in the book, but not in the order's array why?


export async function sendResponse(responseQueue: string, response: EngineResponse): Promise<void> {
  await responseClient.lPush(responseQueue, JSON.stringify(response));
}

function handleEngineRequest(message: EngineRequest) {
  if (message.type == "new_user"){
    const userId = message.payload as unknown as string;
    const userBalance = BALANCES.get(userId);
    if (!userBalance){
      const balance = BALANCES.set(userId, {
        USD: {
          available: 0,
          locked: 0
        },
        INR: {
          available: 0,
          locked: 0
        }
      });
      console.log("Balance Initialized", balance);
    }
  }

  if (message.type == "update_balance"){
    const data = message.payload as unknown as { symbol : string, userId : string, amount : number};
    const userBalance = BALANCES.get(data.userId);
    if (!userBalance){
      console.log("No initialization of the wallet found");
      return;
    }
    if (data.symbol == "USD"){
      const usd = userBalance.USD;
      usd!.available += data.amount;
      console.log("Balance Updated for USD", usd?.available);
      sendResponse(process.env.RESPONSE_QUEUE!, {
        correlationId: message.correlationId,
        ok: true,
        data: {
          "status" : "balanceUpdated",
          "balance" : {
            available : usd?.available,
            locked : usd?.locked
          }
        }
      })
      return;
    }
    else if (data.symbol == "INR"){
      const inr = userBalance.INR;
      inr!.available += data.amount;
      console.log("Balance Updated for INR", inr?.available);
      sendResponse(process.env.RESPONSE_QUEUE!, {
        correlationId: message.correlationId,
        ok: true,
        data: {
          "status" : "balanceUpdated",
          "balance" : {
            available : inr?.available,
            locked : inr?.locked
          }
        }
      })
      return;
    }
    else{
      sendResponse(process.env.RESPONSE_QUEUE!, {
        correlationId: message.correlationId,
        ok: false,
        error: "Only USD and INR are supported"
      })
    }
  }

  if (message.type == "create_order") {
    const payload = message.payload as unknown as CreateOrderPayload;
    if (!payload) {
      throw new Error("Wrong Payload");
    }
    const type = payload.type;

    let orderbook = ORDERBOOKS.get(payload.symbol);
    if (!orderbook) {
      console.log("OrderBook is : ", orderbook);
      throw new Error("Orderbook is not present");
    }

    let orderId = uuid();
    let userOrder: OrderRecord = {
      orderId: orderId,
      userId: payload.userId,
      side: payload.side,
      type: payload.type,
      symbol: payload.symbol,
      price: payload.price,
      qty: payload.qty,
      filledQty: 0,
      status: "open",
      fills: [],
      createdAt: Date.now()
    }

    ORDERS.set(orderId, userOrder);

    if (payload.side == "buy") {
      sortBids(userOrder);
    } else {
      sortAsks(userOrder);
    }

    if (type == "limit") {
      if (payload.side == "buy") {
        console.log("Payload for this buying order is :::", payload);

        let filledOrder = [];

        for (const [price, orders] of orderbook?.asks) {
          if (price <= payload.price!) {
            for (let i = 0; i < orders.length; i++) {

              const sellingOrder = orders[i];
              if (!sellingOrder) {
                continue;
              }
              const sellingQty = Math.min(sellingOrder?.qty, payload.qty);
              //Fill some order;
              const fill: Fill = {
                buyOrderId: orderId,
                fillId: uuid(),
                price: sellingOrder.price,
                qty: sellingQty,
                symbol: sellingOrder.symbol,
                createdAt: Date.now(),
                sellOrderId: sellingOrder.orderId
              }

              filledOrder.push(fill);

              sellingOrder.qty -= sellingQty;
             
              payload.qty -= sellingQty;

              if (sellingOrder.qty === 0) {
                orders.splice(i, 1);
                i--;
              }

              FILLS.push(fill);

              const order = ORDERS.get(orderId);
              if (!order) {
                throw new Error("ORDER doesn't exists");
              }
              order.filledQty += sellingQty;
              order.qty -= sellingQty;

              order.fills.push(fill);

              if (payload.qty == 0) {
                order.status == "filled"
                sendResponse(process.env.RESPONSE_QUEUE!, {
                  correlationId: message.correlationId,
                  ok: true,
                  data: {
                    "status": "filled",
                    "filledQty": fill.qty,
                    "averagePrice": sellingOrder.price / sellingQty
                  }
                })
                console.log("OrderMatched Successfully")
                return;
              }
              else {
                order.status == "partially_filled"
                //Partial fill case : 
                sendResponse(process.env.RESPONSE_QUEUE!, {
                  correlationId: message.correlationId,
                  ok: true,
                  data: {
                    "status": "partially_filled",
                    "filledQty": fill.qty,
                    "averagePrice": sellingOrder.price / sellingQty
                  }
                })
                return;
              }
            }
          }
          // sendResponse(process.env.RESPONSE_QUEUE!, {
          //   correlationId: message.correlationId,
          //   ok: true,
          //   data: {
          //     fills: filledOrder
          //   }
          // })
        }
        addBids(payload, orderbook, message, orderId);
      } else {
        console.log("Limit sell ORder :::");

        let orderbook = ORDERBOOKS.get(payload.symbol);
        if (!orderbook) {
          throw new Error("Orderbook is not present");
        }
        for (const [price, orders] of orderbook?.bids) {
          if (price >= payload.price!) {
            for (let i = 0; i < orders.length; i++) {
              const buyingOrder = orders[i];
              if (!buyingOrder) {
                continue;
              }
              const buyingQty = Math.min(buyingOrder?.qty, payload.qty);
              //Fill some order;
              const fillOrderId = uuid();
              const fill: Fill = {
                buyOrderId: orderId,
                fillId: fillOrderId,
                price: buyingOrder.price,
                qty: buyingQty,
                symbol: buyingOrder.symbol,
                createdAt: Date.now(),
                sellOrderId: buyingOrder.orderId
              }

              buyingOrder.qty -= buyingQty;

              if (buyingOrder.qty === 0) {
                orders.splice(i, 1);
                i--;
              }
              console.log("Payload qty is : ", payload.qty);
              console.log("Buying qty is : ", buyingQty);
              payload.qty -= buyingQty;

              FILLS.push(fill);

              const order = ORDERS.get(orderId);
              if (!order) {
                throw new Error("ORDER doesn't exists");
              }
              order.filledQty += buyingQty;
              order.qty -= buyingQty;

              order.fills.push(fill);


              if (payload.qty == 0) {
                sendResponse(process.env.RESPONSE_QUEUE!, {
                  correlationId: message.correlationId,
                  ok: true,
                  data: {
                    "status": "filled",
                    "filledQty": fill.qty,
                    "averagePrice": buyingOrder.price / buyingQty
                  }
                })
                console.log("Book at this price is : ", orderbook.bids.values);
                console.log("OrderMatched Successfully")
                return;
              }
              else {
                //Partial fill case : 
                sendResponse(process.env.RESPONSE_QUEUE!, {
                  correlationId: message.correlationId,
                  ok: true,
                  data: {
                    "status": "partially_filled",
                    "filledQty": fill.qty,
                    "averagePrice": buyingOrder.price / buyingQty
                  }
                })
              }
            }
            return;
          }
        }
        addAsks(payload, orderbook, message, orderId);
      }
    }

  }


  if (message.type == "get_order") {
    const payload: GetOrder = message.payload as unknown as GetOrder;
    const { userId, orderId } = payload;
    const order = ORDERS.get(orderId);
    if (!order) {
      sendResponse(process.env.RESPONSE_QUEUE!, {
        correlationId: message.correlationId,
        ok: false,
        error: "order not found"
      })
    }
    if (order?.userId !== userId) {
      sendResponse(process.env.RESPONSE_QUEUE!, {
        correlationId: message.correlationId,
        ok: false,
        error: "order not found"
      })
    }
    let orderStatus = order?.status;

    if (orderStatus == "open") {
      let orderResponse = {
        orderId: orderId,
        side: order?.side,
        type: "limit",
        symbol: order?.symbol,
        price: order?.price,
        qty: order?.qty,
        filledQty: order?.filledQty,
        status: order?.status,
        fills: order?.fills
      }
      sendResponse(process.env.RESPONSE_QUEUE!, {
        correlationId: message.correlationId,
        ok: true,
        data: orderResponse
      })
    }
    else if (orderStatus == "partially_filled") {
      let orderResponse = {
        orderId: orderId,
        side: order?.side,
        type: "limit",
        symbol: order?.symbol,
        price: order?.price,
        qty: order?.qty,
        filledQty: order?.filledQty,
        status: order?.status,
        fills: order?.fills
      }
      sendResponse(process.env.RESPONSE_QUEUE!, {
        correlationId: message.correlationId,
        ok: true,
        data: orderResponse
      })
    }
    else if (orderStatus == "filled") {
      let orderResponse = {
        orderId: order?.orderId,
        status: order?.status,
        filledQty: order?.filledQty,
        fills: order?.fills
      }
      sendResponse(process.env.RESPONSE_QUEUE!, {
        correlationId: message.correlationId,
        ok: true,
        data: orderResponse
      })
    } else {
      throw new Error("Order is closed");
    }
  }

  if (message.type == "get_depth") {

    const payload = message.payload as unknown as GetDepth;
    const orderBook = ORDERBOOKS.get(payload.symbol);
    console.log(orderBook);
    if (!orderBook) {
      sendResponse(process.env.RESPONSE_QUEUE!, {
        correlationId: message.correlationId,
        ok: true,
        data: {
          "symbol": payload.symbol,
          bids: [],
          asks: []
        }
      });
      return;
    }
    console.log("Orderbook at price 100 is : ", orderBook.bids.values());

    let bids = [];
    let asks = [];

    for (let i = 0; i < sortedBids.length; i++) {
      const bidsPerPrice = orderBook.bids.get(sortedBids[i]!);
      if (!bidsPerPrice) {
        continue;
      }
      let qty = 0;
      for (let i = 0; i < bidsPerPrice?.length!; i++) {
        const bid = bidsPerPrice[i];
        console.log("Bid found at price", bidsPerPrice, "is", bid);
        if (!bid) {
          throw new Error("Bid doesn't exists");
        }
        console.log("ADDING", bid.qty);
        qty += bid?.qty;
      }
      let obj = {
        price: sortedBids[i]!,
        qty: qty
      }
      if (qty == 0) {
        continue;
      }
      bids.push(obj);
    }
    for (let i = 0; i < sortedAsks.length; i++) {
      const asksPerPrice = orderBook.asks.get(sortedAsks[i]!);
      if (!asksPerPrice) {
        continue;
      }
      let qty = 0;
      for (let i = 0; i < asksPerPrice?.length!; i++) {
        const ask = asksPerPrice[i];
        if (!ask) {
          throw new Error("Bid doesn't exists");
          return;
        }
        qty += ask?.qty;
      }
      let obj = {
        price: sortedAsks[i]!,
        qty: qty
      }
      if (qty == 0) {
        continue;
      }
      asks.push(obj);
    }
    //Sending Response when there is something in the book.
    console.log("Sending Response when there is something in the book.");
    sendResponse(process.env.RESPONSE_QUEUE!, {
      correlationId: message.correlationId,
      ok: true,
      data: {
        "symbol": payload.symbol,
        bids,
        asks
      }
    })

  }


  if (message.type == "get_user_balance") {
    const payload: GetUserBalance = message.payload as unknown as GetUserBalance;
  }


  if (message.type == "cancel_order") {
    const payload: CancelOrder = message.payload as unknown as CancelOrder;
    const { userId, orderId } = payload;
    const order = ORDERS.get(orderId);
    console.log("Order", order);
    const book = ORDERBOOKS.get(order?.symbol!);
    const values = book?.bids.values();
    console.log("Valued in the cancel-order part ", values);
    if (!book) {
      console.log("Book is not present");
      return;
    }

    if (!order) {
      console.log("Order not found");
      return;
    }
    if (order.status == "cancelled") {
      throw new Error("Order is already cancelled");
    }
    if (order.status == "filled") {
      throw new Error("filled ordered cannot be cancelled");
    }
    if (order.side == "buy") {
      removeBidFromBook(userId, orderId, order, book);
      sendResponse(process.env.RESPONSE_QUEUE!, {
        correlationId: message.correlationId,
        ok: true,
        data: {
          status: order.status,
          qty: order.qty,
          filledQty: order.filledQty
        }
      })

    } else {
      removeAsksFromBook(userId, orderId, order, book);
      sendResponse(process.env.RESPONSE_QUEUE!, {
        correlationId: message.correlationId,
        ok: true,
        data: {
          status: order.status,
          qty: order.qty,
          filledQty: order.filledQty
        }
      })
    }
  }
}

console.log(`Engine listening on Redis queue: ${env.incomingQueue}`);

//Infinite loop
for (; ;) {
  const item = await brokerClient.brPop(env.incomingQueue, 0);
  if (!item) continue;

  let message: EngineRequest;

  try {
    message = JSON.parse(item.element) as EngineRequest;
  } catch {
    console.error("Skipping invalid broker message");
    continue;
  }

  try {
    const data = handleEngineRequest(message);
    await sendResponse(message.responseQueue, {
      correlationId: message.correlationId,
      ok: true,
      data,
    });
  } catch (error) {
    await sendResponse(message.responseQueue, {
      correlationId: message.correlationId,
      ok: false,
      error: error instanceof Error ? error.message : "engine_error",
    });
  }
}


