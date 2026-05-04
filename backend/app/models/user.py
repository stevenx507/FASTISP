from datetime import datetime, timezone
from werkzeug.security import check_password_hash, generate_password_hash
from app import db

class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, default='client')  # 'client' or 'admin'
    name = db.Column(db.String(120), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True)
    mfa_enabled = db.Column(db.Boolean, default=False, nullable=False)
    mfa_secret = db.Column(db.String(128))

    # Relationship to Client
    client = db.relationship('Client', back_populates='user', uselist=False, cascade="all, delete-orphan")
    partner_profile = db.relationship('Partner', back_populates='user', uselist=False, cascade="all, delete-orphan")
    tenant = db.relationship('Tenant', back_populates='users')
    tickets = db.relationship('Ticket', back_populates='user')

    def set_password(self, password):
        """Hashes and sets the user's password."""
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        """Checks if the provided password matches the stored hash."""
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        """Serializes the User object to a dictionary."""
        user_data = {
            'id': self.id,
            'name': self.name,
            'email': self.email,
            'role': self.role,
            'tenant_id': self.tenant_id,
            'mfa_enabled': self.mfa_enabled,
        }
        if self.role == 'client' and self.client and self.client.plan:
            user_data['plan'] = self.client.plan.name
            user_data['client_id'] = self.client.id
        return user_data

    def __repr__(self):
        return f'<User {self.email}>'
