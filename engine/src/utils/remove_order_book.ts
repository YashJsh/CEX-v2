import type { OrderBook, OrderRecord } from "../store/exchange-store";

export const removeBidFromBook = (userId : string, orderId : string, order : OrderRecord, book : OrderBook) => {
    const orders = book.bids.get(order?.price!);
    if (!orders) {
        console.log("NO orders exists");
        return false;
    }
    for (let i = 0; i < orders?.length; i++) {
        if (orders[i]?.orderId == orderId && orders[i]?.userId == userId) {
            orders.splice(i, 1);
        }
    }
    order.status = "cancelled";
    return true;
}

export const removeAsksFromBook = (userId : string, orderId : string, order : OrderRecord, book : OrderBook) :boolean=> {
    const orders = book.asks.get(order?.price!);
    if (!orders) {
        console.log("NO orders exists");
        return false;
    }
    for (let i = 0; i < orders?.length; i++) {
        if (orders[i]?.orderId == orderId && orders[i]?.userId == userId) {
            orders.splice(i, 1);
        }
    }
    order.status = "cancelled";
    return true;
}