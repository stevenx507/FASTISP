from datetime import datetime, timezone
from app import db

class ProductCategory(db.Model):
    __tablename__ = 'product_categories'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.Text, nullable=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)

    tenant = db.relationship('Tenant', back_populates='product_categories')
    products = db.relationship('Product', back_populates='category')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'tenant_id': self.tenant_id,
        }

class Supplier(db.Model):
    __tablename__ = 'suppliers'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    contact_email = db.Column(db.String(120), nullable=True)
    contact_phone = db.Column(db.String(20), nullable=True)
    address = db.Column(db.Text, nullable=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)

    tenant = db.relationship('Tenant', back_populates='suppliers')
    products = db.relationship('Product', back_populates='supplier')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'contact_email': self.contact_email,
            'contact_phone': self.contact_phone,
            'address': self.address,
            'tenant_id': self.tenant_id,
        }

class Product(db.Model):
    __tablename__ = 'products'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.Text, nullable=True)
    sku = db.Column(db.String(50), unique=True, nullable=False)
    category_id = db.Column(db.Integer, db.ForeignKey('product_categories.id'), nullable=True)
    supplier_id = db.Column(db.Integer, db.ForeignKey('suppliers.id'), nullable=True)
    unit_cost = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    unit_price = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    stock_quantity = db.Column(db.Integer, nullable=False, default=0)
    min_stock_level = db.Column(db.Integer, nullable=False, default=0)
    max_stock_level = db.Column(db.Integer, nullable=True)
    location = db.Column(db.String(120), nullable=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)

    tenant = db.relationship('Tenant', back_populates='products')
    category = db.relationship('ProductCategory', back_populates='products')
    supplier = db.relationship('Supplier', back_populates='products')
    inventory_movements = db.relationship('InventoryMovement', back_populates='product')
    units = db.relationship('ProductUnit', back_populates='product')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'sku': self.sku,
            'category_id': self.category_id,
            'supplier_id': self.supplier_id,
            'unit_cost': float(self.unit_cost or 0),
            'unit_price': float(self.unit_price or 0),
            'stock_quantity': self.stock_quantity,
            'min_stock_level': self.min_stock_level,
            'max_stock_level': self.max_stock_level,
            'location': self.location,
            'tenant_id': self.tenant_id,
        }

class InventoryMovement(db.Model):
    __tablename__ = 'inventory_movements'

    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=False)
    movement_type = db.Column(db.String(20), nullable=False)  # 'in', 'out', 'adjustment'
    quantity = db.Column(db.Integer, nullable=False)
    reason = db.Column(db.String(120), nullable=True)
    reference = db.Column(db.String(120), nullable=True)
    unit_cost = db.Column(db.Numeric(10, 2), nullable=True)
    notes = db.Column(db.Text, nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    product = db.relationship('Product', back_populates='inventory_movements')
    user = db.relationship('User')

    def to_dict(self):
        return {
            'id': self.id,
            'product_id': self.product_id,
            'movement_type': self.movement_type,
            'quantity': self.quantity,
            'reason': self.reason,
            'reference': self.reference,
            'unit_cost': float(self.unit_cost or 0),
            'notes': self.notes,
            'created_by': self.created_by,
            'tenant_id': self.tenant_id,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

class ProductUnit(db.Model):
    __tablename__ = 'product_units'

    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=False)
    serial_number = db.Column(db.String(100), unique=True, nullable=False, index=True)
    mac_address = db.Column(db.String(20), nullable=True, index=True)
    status = db.Column(db.String(20), default='available', nullable=False)
    client_id = db.Column(db.Integer, db.ForeignKey('clients.id'), nullable=True)
    total_length = db.Column(db.Float, nullable=True)
    remaining_length = db.Column(db.Float, nullable=True)
    notes = db.Column(db.Text, nullable=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    product = db.relationship('Product', back_populates='units')
    tenant = db.relationship('Tenant', back_populates='product_units')

    def to_dict(self):
        return {
            'id': self.id,
            'product_id': self.product_id,
            'serial_number': self.serial_number,
            'mac_address': self.mac_address,
            'status': self.status,
            'client_id': self.client_id,
            'notes': self.notes,
            'total_length': self.total_length,
            'remaining_length': self.remaining_length,
        }
