"""Create the core business schema required by the existing API migrations."""
from alembic import op
import sqlalchemy as sa

revision='0000_foundation'
down_revision=None
branch_labels=None
depends_on=None


def _create_if_missing(name, columns, constraints=()):
    if name not in set(sa.inspect(op.get_bind()).get_table_names()):
        op.create_table(name, *columns, *constraints)


def _index_if_missing(table, name, columns):
    indexes={item['name'] for item in sa.inspect(op.get_bind()).get_indexes(table)}
    if name not in indexes:
        op.create_index(name, table, columns)


def upgrade():
    _create_if_missing('businesses', [
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('name', sa.String(120), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    ])
    _create_if_missing('locations', [
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('business_id', sa.String(36), sa.ForeignKey('businesses.id'), nullable=False),
        sa.Column('name', sa.String(120), nullable=False),
    ])
    _create_if_missing('terminals', [
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('business_id', sa.String(36), sa.ForeignKey('businesses.id'), nullable=False),
        sa.Column('location_id', sa.String(36), sa.ForeignKey('locations.id'), nullable=False),
        sa.Column('name', sa.String(120), nullable=False),
        sa.Column('app_version', sa.String(32), nullable=False),
        sa.Column('local_schema_version', sa.Integer, nullable=False),
        sa.Column('sync_protocol_version', sa.Integer, nullable=False),
    ])
    _create_if_missing('menu_items', [
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('business_id', sa.String(36), sa.ForeignKey('businesses.id'), nullable=False),
        sa.Column('name', sa.String(160), nullable=False),
        sa.Column('category', sa.String(80), nullable=False),
        sa.Column('price_pesewas', sa.Integer, nullable=False),
    ])
    _create_if_missing('orders', [
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('business_id', sa.String(36), sa.ForeignKey('businesses.id'), nullable=False),
        sa.Column('location_id', sa.String(36), sa.ForeignKey('locations.id'), nullable=False),
        sa.Column('terminal_id', sa.String(36), sa.ForeignKey('terminals.id'), nullable=False),
        sa.Column('receipt_no', sa.String(80), nullable=False),
        sa.Column('total_pesewas', sa.Integer, nullable=False),
        sa.Column('payment_method', sa.String(20), nullable=False),
        sa.Column('occurred_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('payload', sa.JSON, nullable=False),
        sa.Column('synced_at', sa.DateTime(timezone=True), nullable=False),
    ], [sa.UniqueConstraint('business_id', 'receipt_no', name='uq_business_receipt')])
    _create_if_missing('sync_events', [
        sa.Column('event_id', sa.String(36), primary_key=True),
        sa.Column('entity_id', sa.String(36), nullable=False),
        sa.Column('business_id', sa.String(36), nullable=False),
        sa.Column('event_type', sa.String(80), nullable=False),
        sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
    ])

    for table, name, columns in (
        ('locations', 'ix_locations_business_id', ['business_id']),
        ('terminals', 'ix_terminals_business_id', ['business_id']),
        ('terminals', 'ix_terminals_location_id', ['location_id']),
        ('menu_items', 'ix_menu_items_business_id', ['business_id']),
        ('orders', 'ix_orders_business_id', ['business_id']),
        ('orders', 'ix_orders_location_id', ['location_id']),
        ('orders', 'ix_orders_terminal_id', ['terminal_id']),
        ('orders', 'ix_orders_receipt_no', ['receipt_no']),
        ('sync_events', 'ix_sync_events_entity_id', ['entity_id']),
        ('sync_events', 'ix_sync_events_business_id', ['business_id']),
    ):
        _index_if_missing(table, name, columns)


def downgrade():
    raise RuntimeError('Rollback application code; retain tenant, operational and financial data.')

