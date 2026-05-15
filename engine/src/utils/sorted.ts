import { sortedAsks, sortedBids, type OrderRecord } from "../store/exchange-store";

export const sortBids = (order : OrderRecord)=>{
    const price = order.price;
    if (!price){
        throw new Error("Market Order has no price");
    }
    if (sortedBids.length === 0){
        sortedBids.push(price!);
        return;
    }
    for (let i = 0; i<= sortedBids.length; i++){
        if (sortedBids[i] == price){
            return;
        }
        if (sortedBids[i]!<price){
            sortedBids.splice(i, 0, price);
            return;
        }
    }
    sortedBids.push(price)
}

export const sortAsks = (order : OrderRecord)=>{
    const price = order.price;
    if (!price){
        throw new Error("Market Order has no price");
    }
    if (sortedAsks.length === 0){
        sortedAsks.push(price!);
        return;
    }
    for (let i = 0; i<= sortedAsks.length; i++){
        if (sortedAsks[i] == price){
            return;
        }
        if (sortedAsks[i]!>price){
            sortedAsks.splice(i, 0, price);
            return;
        }
    }
    sortedAsks.push(price)
}