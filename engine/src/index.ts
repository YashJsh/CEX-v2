import "dotenv/config";
import { createClient } from "redis";
import { env } from "./utils/env.js";
import { BALANCES, FILLS, ORDERBOOKS, ORDERS, type Balance, type Fill, type OrderBook, type OrderRecord, type OrderType, type RestingOrder } from "./store/exchange-store.js";
import type { CancelOrder, CreateOrderPayload, GetDepth, GetOrder, GetUserBalance } from "./utils/types.js";
import { uuid } from "uuidv4";

export type EngineCommandType =
  | "create_order"
  | "get_depth"
  | "get_user_balance"
  | "get_order"
  | "cancel_order";

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


async function sendResponse(responseQueue: string, response: EngineResponse): Promise<void> {
  await responseClient.lPush(responseQueue, JSON.stringify(response));
}

function handleEngineRequest(message: EngineRequest) {
  if (message.type == "create_order") {
    const payload = message.payload as unknown as CreateOrderPayload;
    if (!payload) {
      throw new Error("Wrong Payload");
    }

    const type = payload.type;
    if (type == "limit") {
      if (payload.side == "buy") {
        console.log("Payload for this buying order is :::", payload);
        let buyOrderId = uuid();


        let orderbook = ORDERBOOKS.get(payload.symbol);
        console.log("ORderBook");
        if (!orderbook) {

          console.log("OrderBook is : ", orderbook);
          throw new Error("Orderbook is not present");
        }

        // Push to the orders as well first.
        let userOrder : OrderRecord  = {
          orderId: buyOrderId,
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

        ORDERS.set(buyOrderId, userOrder);

        let filledOrder = [];
        for (const [price, orders] of orderbook?.asks) {
          if (price <= payload.price!) {
            for (let i = 0; i < orders.length; i++) {
        
              const buyingOrder = orders[i];
              if (!buyingOrder) {
                continue;
              }
              const sellingQty = Math.min(buyingOrder?.qty, payload.qty);
              //Fill some order;
              const fill: Fill = {
                buyOrderId: buyOrderId,
                fillId: uuid(),
                price: buyingOrder.price,
                qty: sellingQty,
                symbol: buyingOrder.symbol,
                createdAt: Date.now(),
                sellOrderId: buyingOrder.orderId
              }

              filledOrder.push(fill);

              if (buyingOrder.qty != 0) {
                buyingOrder.qty -= sellingQty
              } else {
                orders.splice(i, 1);
              }

              payload.qty -= sellingQty;
              
              FILLS.push(fill);

              let order = ORDERS.get(buyOrderId);
              if (!order){
                throw new Error("ORDER doesn't exists");
              }
              order.fills.push(fill);

              if (payload.qty == 0) {
                order.status == "filled"
                sendResponse(process.env.RESPONSE_QUEUE!, {
                  correlationId: message.correlationId,
                  ok: true,
                  data: {
                    "status": "filled",
                    "filledQty": fill.qty,
                    "averagePrice": buyingOrder.price / sellingQty
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
                    "averagePrice": buyingOrder.price / sellingQty
                  }
                })
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
        addBids(payload, orderbook, message);
      } else {
        console.log("Limit sell ORder :::");
        console.log("Payload for this order is :::", payload);
        let sellOrderId = "sellOrderId";

        let orderbook = ORDERBOOKS.get(payload.symbol);
        if (!orderbook) {
          throw new Error("Orderbook is not present");
        }
        for (const [price, order] of orderbook?.bids) {
          if (price >= payload.price!) {
            for (let i = 0; i < order.length; i++) {
              const buyingOrder = order[i];
              if (!buyingOrder) {
                continue;
              }
              const buyingQty = Math.min(buyingOrder?.qty, payload.qty);
              //Fill some order;
              const fill: Fill = {
                buyOrderId: sellOrderId,
                fillId: "fillOrderId",
                price: buyingOrder.price,
                qty: buyingQty,
                symbol: buyingOrder.symbol,
                createdAt: Date.now(),
                sellOrderId: buyingOrder.orderId
              }

              if (buyingOrder.qty != 0) {
                buyingOrder.qty -= buyingQty
              } else {
                order.splice(i, 1);
              }
              console.log("Payload qty is : ", payload.qty);
              console.log("Buying qty is : ", buyingQty);
              payload.qty -= buyingQty;

              FILLS.push(fill);

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
          }
        }
        addAsks(payload, orderbook, message);
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
    const payload: GetDepth = message.payload as unknown as GetDepth;
  }
  if (message.type == "get_user_balance") {
    const payload: GetUserBalance = message.payload as unknown as GetUserBalance;
  }
  if (message.type == "cancel_order") {
    const payload: CancelOrder = message.payload as unknown as CancelOrder;
  }
}

console.log(`Engine listening on Redis queue: ${env.incomingQueue}`);

const addBids = async (order: CreateOrderPayload, orderbook: OrderBook, message: EngineRequest): Promise<void> => {
  let restingOrder: RestingOrder = {
    orderId: "orderId",
    userId: order.userId,
    side: order.side,
    type: "limit",
    symbol: order.symbol,
    price: order.price!,
    qty: order.qty,
    filledQty: 0,
    status: "open",
    createdAt: Date.now()
  }

  if (!orderbook.bids.has(restingOrder.price)) {
    orderbook.bids.set(restingOrder.price, [restingOrder]);
    console.log("ORderbook after pushing for the first time is  : ", orderbook);
  }

  for (const [price, orders] of orderbook.bids) {
    if (price <= restingOrder.price) {
      orders.push(restingOrder);
      console.log("ORderbook after pushing is : ", orderbook);
    }
  }
  console.log("Resting order is : ", restingOrder);
  console.log("ORDERBOOK IS : ", ORDERBOOKS.get("BTC"));
  sendResponse(process.env.RESPONSE_QUEUE!, {
    correlationId: message.correlationId,
    ok: true,
    data: restingOrder
  })
}

const addAsks = async (order: CreateOrderPayload, orderbook: OrderBook, message: EngineRequest): Promise<void> => {
  let restingOrder: RestingOrder = {
    orderId: "orderId",
    userId: order.userId,
    side: order.side,
    type: "limit",
    symbol: order.symbol,
    price: order.price!,
    qty: order.qty,
    filledQty: 0,
    status: "open",
    createdAt: Date.now()
  }
  if (!orderbook.asks.has(restingOrder.price)) {
    orderbook.asks.set(restingOrder.price, [restingOrder]);
    console.log("ORderbook after pushing for the first time is  : ", orderbook);
  }

  for (const [price, orders] of orderbook.asks) {
    if (price <= restingOrder.price) {
      orders.push(restingOrder);
    }
  }
  console.log("ORDERBOOK IS : ", ORDERBOOKS.get("BTC"));
  sendResponse(process.env.RESPONSE_QUEUE!, {
    correlationId: message.correlationId,
    ok: true,
    data: restingOrder
  })

}

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


