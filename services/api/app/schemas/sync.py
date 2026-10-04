from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field
from app.schemas.admin import Operation

class OrderItemPayload(BaseModel):
    id: str
    menu_item_id: str
    name: str
    quantity: int = Field(gt=0)
    unit_price_pesewas: int = Field(ge=0)
    requires_kitchen: bool = False
    track_stock: bool = False
    variation_id: str | None = None
    variation_name: str | None = None

class OrderPayload(BaseModel):
    id: str
    receipt_no: str
    total_pesewas: int = Field(ge=0)
    payment_method: Literal["CASH", "MOMO", "CARD"]
    items: list[OrderItemPayload]
    order_type: Literal['DINE_IN','TAKEAWAY'] = 'TAKEAWAY'
    notes: str = ''
    customer_id: str | None = None
    shift_id: str | None = None
    cashier_id: str | None = None
    cashier_name: str = ''
    currency: Literal['GHS','USD','GBP','EUR'] = 'GHS'
    amount_tendered: int | None = Field(default=None,ge=0)
    change: int = Field(default=0,ge=0)
    payment_reference: str = Field(default='',max_length=200)
    receipt_snapshot: dict = Field(default_factory=dict)
    stock_movements:list[Operation]=Field(default_factory=list)

class SyncEnvelope(BaseModel):
    event_id: str
    event_type: Literal["order.completed"]
    entity_id: str
    business_id: str
    location_id: str
    terminal_id: str
    app_version: str
    local_schema_version: int
    sync_protocol_version: int
    occurred_at: datetime
    payload: OrderPayload

class SyncAck(BaseModel):
    event_id: str
    status: Literal["accepted", "already_processed"]
    entity_id: str
