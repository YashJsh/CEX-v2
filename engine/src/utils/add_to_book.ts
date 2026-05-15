import { sendResponse, type EngineRequest } from "..";
import { ORDERBOOKS, type OrderBook, type RestingOrder } from "../store/exchange-store";
import type { CreateOrderPayload } from "./types";

const addBids = async (order: CreateOrderPayload, orderbook: OrderBook, message: EngineRequest, orderId : string): Promise<void> => {
    let restingOrder: RestingOrder = {
      orderId: orderId,
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
      sendResponse(process.env.RESPONSE_QUEUE!, {
        correlationId: message.correlationId,
        ok: true,
        data: restingOrder
      });
      return;
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
  
  const addAsks = async (order: CreateOrderPayload, orderbook: OrderBook, message: EngineRequest, orderId : string): Promise<void> => {
    let restingOrder: RestingOrder = {
      orderId: orderId,
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
      sendResponse(process.env.RESPONSE_QUEUE!, {
        correlationId: message.correlationId,
        ok: true,
        data: restingOrder
      });
      return;
    }
  
    for (const [price, orders] of orderbook.asks) {
      if (price <= restingOrder.price) {
        orders.push(restingOrder);
      }
    }
    console.log("ORDERBOOK IS : ", ORDERBOOKS.get("BTC"));
  }
  

  export { addAsks, addBids }