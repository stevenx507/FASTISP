from .utils import *

@admin_bp.route('/admin/inventory/summary', methods=['GET'])
@admin_required()
def admin_inventory_summary():
    tenant_id = current_tenant_id()

    clients_query = Client.query.options(joinedload(Client.plan))
    routers_query = MikroTikRouter.query
    if tenant_id is not None:
        clients_query = clients_query.filter_by(tenant_id=tenant_id)
        routers_query = routers_query.filter_by(tenant_id=tenant_id)

    clients = clients_query.all()
    routers_count = routers_query.count()
    clients_count = len(clients)

    defaults = [
        {
            "sku": "ONU-GPON",
            "name": "ONU GPON",
            "category": "onu",
            "total": max(30, clients_count + 20),
            "assigned": clients_count,
            "reorder_point": 15,
            "unit": "units",
        },
        {
            "sku": "CPE-DUAL",
            "name": "Router CPE Dual Band",
            "category": "cpe",
            "total": max(40, clients_count + 35),
            "assigned": clients_count,
            "reorder_point": 20,
            "unit": "units",
        },
        {
            "sku": "ROUTER-CORE",
            "name": "MikroTik Core Router",
            "category": "router",
            "total": max(8, routers_count + 3),
            "assigned": routers_count,
            "reorder_point": 3,
            "unit": "units",
        },
        {
            "sku": "FIBER-SM",
            "name": "Fibra Monomodo",
            "category": "fiber",
            "total": max(80.0, round(clients_count * 0.11 + 40.0, 1)),
            "assigned": round(clients_count * 0.065, 1),
            "reorder_point": 25.0,
            "unit": "km",
        },
    ]

    items = []
    alerts = []
    for raw in defaults:
        available = round(max(0, raw["total"] - raw["assigned"]), 1 if raw["unit"] == "km" else 0)
        if available <= raw["reorder_point"] * 0.5:
            level = "critical"
        elif available <= raw["reorder_point"]:
            level = "warning"
        else:
            level = "ok"
        item = {
            **raw,
            "available": available,
            "status": level,
            "updated_at": _iso_utc_now(),
        }
        items.append(item)
        if level != "ok":
            alerts.append({
                "sku": raw["sku"],
                "name": raw["name"],
                "level": level,
                "available": available,
                "reorder_point": raw["reorder_point"],
            })

    plan_distribution_map: dict[str, int] = {}
    for client in clients:
        plan_name = client.plan.name if client.plan else "Sin plan"
        plan_distribution_map[plan_name] = plan_distribution_map.get(plan_name, 0) + 1
    plan_distribution = [
        {"plan": plan, "clients": count}
        for plan, count in sorted(plan_distribution_map.items(), key=lambda item: item[1], reverse=True)[:8]
    ]

    summary = {
        "clients_total": clients_count,
        "routers_total": routers_count,
        "stock_items": len(items),
        "low_stock_items": len(alerts),
        "available_units": round(sum(float(item["available"]) for item in items), 1),
        "updated_at": _iso_utc_now(),
    }
    _audit("inventory_summary", entity_type="inventory", metadata=summary)
    return jsonify({
        "summary": summary,
        "items": items,
        "alerts": alerts,
        "plan_distribution": plan_distribution,
    }), 200



@admin_bp.route('/admin/installations', methods=['GET'])
@permission_required('installations.read')
def admin_installations_list():
    tenant_id = current_tenant_id()
    key = _installations_key(tenant_id)
    rows = _tenant_scoped_query(AdminInstallation, tenant_id).order_by(AdminInstallation.created_at.desc()).all()
    if not rows:
        cached_items = _load_cached_list(key)
        seed_items = cached_items or _default_installations(tenant_id)
        for entry in seed_items:
            db.session.add(_installation_model_from_entry(entry, tenant_id))
        db.session.commit()
        rows = _tenant_scoped_query(AdminInstallation, tenant_id).order_by(AdminInstallation.created_at.desc()).all()
    items = [row.to_dict() for row in rows]

    status_filter = (request.args.get('status') or '').strip().lower()
    technician_filter = (request.args.get('technician') or '').strip().lower()
    if status_filter:
        items = [item for item in items if str(item.get("status", "")).lower() == status_filter]
    if technician_filter:
        items = [
            item for item in items if technician_filter in str(item.get("technician", "")).lower()
        ]

    summary = {status: 0 for status in INSTALLATION_ALLOWED_STATUS}
    for item in items:
        state = str(item.get("status") or "pending")
        summary[state] = summary.get(state, 0) + 1
    return jsonify({"items": items, "count": len(items), "summary": summary}), 200



@admin_bp.route('/admin/installations', methods=['POST'])
@permission_required('installations.write')
def admin_installations_create():
    tenant_id = current_tenant_id()
    data = request.get_json() or {}
    actor = _current_actor_snapshot()

    client_id = data.get('client_id')
    client_name = (data.get('client_name') or '').strip()
    client = None
    if client_id:
        client = db.session.get(Client, client_id)
        if not client:
            return jsonify({"error": "Cliente no encontrado"}), 404
        if tenant_id is not None and client.tenant_id not in (None, tenant_id):
            return jsonify({"error": "Cliente fuera del tenant"}), 403
        client_name = client.full_name

    if not client_name:
        return jsonify({"error": "client_name o client_id es requerido"}), 400

    status = (data.get('status') or 'scheduled').strip().lower()
    if status not in INSTALLATION_ALLOWED_STATUS:
        return jsonify({"error": f"status invalido. permitidos: {', '.join(sorted(INSTALLATION_ALLOWED_STATUS))}"}), 400

    raw_scheduled = (data.get('scheduled_for') or '').strip()
    if raw_scheduled:
        try:
            scheduled_for = datetime.fromisoformat(raw_scheduled.replace('Z', '+00:00')).replace(microsecond=0)
        except Exception:
            return jsonify({"error": "scheduled_for debe ser ISO date-time"}), 400
    else:
        scheduled_for = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=1)

    entry = {
        "id": secrets.token_hex(8),
        "client_id": client.id if client else None,
        "client_name": client_name,
        "plan": client.plan.name if client and client.plan else (data.get('plan') or None),
        "router": client.router.name if client and client.router else (data.get('router') or None),
        "address": (data.get('address') or (client.ip_address if client else '') or 'Sin direccion').strip(),
        "status": status,
        "priority": (data.get('priority') or 'normal').strip().lower(),
        "technician": (data.get('technician') or '').strip() or "pendiente@ispfast.local",
        "scheduled_for": scheduled_for.isoformat() + "Z",
        "notes": (data.get('notes') or '').strip(),
        "checklist": {
            "onu_registered": False,
            "cpe_configured": False,
            "signal_validated": False,
            "speedtest_ok": False,
        },
    }
    _apply_operational_entry_create_metadata(entry, actor=actor)
    record = _installation_model_from_entry(entry, tenant_id)
    db.session.add(record)
    db.session.commit()
    payload = record.to_dict()
    _save_cached_list(_installations_key(tenant_id), [payload], max_items=400)
    _audit("installation_create", entity_type="installation", entity_id=record.id, metadata=payload)
    return jsonify({"success": True, "installation": payload}), 201



@admin_bp.route('/admin/installations/<string:installation_id>', methods=['PATCH'])
@permission_required('installations.write')
def admin_installations_update(installation_id):
    tenant_id = current_tenant_id()
    record = _tenant_scoped_query(AdminInstallation, tenant_id).filter_by(id=installation_id).first()
    if not record:
        return jsonify({"error": "Instalacion no encontrada"}), 404

    actor = _current_actor_snapshot()
    entry = record.to_dict()
    _ensure_operational_entry_metadata(entry)
    data = request.get_json() or {}
    if 'status' in data:
        status = str(data.get('status') or '').strip().lower()
        if status not in INSTALLATION_ALLOWED_STATUS:
            return jsonify({"error": f"status invalido. permitidos: {', '.join(sorted(INSTALLATION_ALLOWED_STATUS))}"}), 400
        entry['status'] = status
    if 'priority' in data:
        entry['priority'] = str(data.get('priority') or 'normal').strip().lower() or 'normal'
    if 'technician' in data:
        entry['technician'] = str(data.get('technician') or '').strip() or "pendiente@ispfast.local"
    if 'address' in data:
        entry['address'] = str(data.get('address') or '').strip() or entry.get('address')
    if 'notes' in data:
        entry['notes'] = str(data.get('notes') or '').strip()
    if 'scheduled_for' in data:
        raw_scheduled = str(data.get('scheduled_for') or '').strip()
        if raw_scheduled:
            try:
                scheduled_for = datetime.fromisoformat(raw_scheduled.replace('Z', '+00:00')).replace(microsecond=0)
            except Exception:
                return jsonify({"error": "scheduled_for debe ser ISO date-time"}), 400
            entry['scheduled_for'] = scheduled_for.isoformat() + "Z"
    if 'checklist' in data and isinstance(data.get('checklist'), dict):
        checklist = entry.get('checklist') or {}
        for key_name, value in data['checklist'].items():
            parsed = _parse_bool(value)
            if parsed is None:
                return jsonify({"error": f"checklist.{key_name} debe ser booleano"}), 400
            checklist[str(key_name)] = parsed
        entry['checklist'] = checklist

    if entry.get('status') == 'completed':
        entry['completed_at'] = entry.get('completed_at') or _iso_utc_now()
        entry['completed_by'] = entry.get('completed_by') if entry.get('completed_by') is not None else actor.get("id")
        entry['completed_by_name'] = entry.get('completed_by_name') or str(actor.get("name") or _actor_default_name(actor.get("id")))
    _apply_operational_entry_update_metadata(entry, actor=actor)
    record.client_id = _parse_int(entry.get('client_id'))
    record.client_name = entry.get('client_name')
    record.plan = entry.get('plan')
    record.router = entry.get('router')
    record.address = entry.get('address')
    record.status = entry.get('status')
    record.priority = entry.get('priority')
    record.technician = entry.get('technician')
    record.scheduled_for = _parse_iso_datetime(entry.get('scheduled_for'))
    record.notes = entry.get('notes')
    record.checklist = entry.get('checklist') if isinstance(entry.get('checklist'), dict) else {}
    record.completed_at = _parse_iso_datetime(entry.get('completed_at'))
    record.completed_by = _parse_int(entry.get('completed_by'))
    record.completed_by_name = entry.get('completed_by_name')
    record.created_by = _parse_int(entry.get('created_by'))
    record.created_by_name = entry.get('created_by_name')
    record.created_by_email = entry.get('created_by_email')
    record.updated_by = _parse_int(entry.get('updated_by'))
    record.updated_by_name = entry.get('updated_by_name')
    record.updated_by_email = entry.get('updated_by_email')
    record.created_at = _parse_iso_datetime(entry.get('created_at')) or record.created_at
    record.updated_at = _parse_iso_datetime(entry.get('updated_at')) or datetime.now(timezone.utc)
    db.session.add(record)
    db.session.commit()
    _save_cached_list(_installations_key(tenant_id), [record.to_dict()], max_items=400)
    _audit("installation_update", entity_type="installation", entity_id=installation_id, metadata={"changes": list(data.keys())})
    return jsonify({"success": True, "installation": record.to_dict()}), 200



@admin_bp.route('/admin/inventory/categories', methods=['GET'])
@permission_required('inventory.read')
def admin_inventory_categories_list():
    tenant_id = current_tenant_id()
    query = _tenant_scoped_query(ProductCategory, tenant_id)
    items = [row.to_dict() for row in query.order_by(ProductCategory.name.asc()).all()]
    return jsonify({"items": items, "count": len(items)}), 200



@admin_bp.route('/admin/inventory/categories', methods=['POST'])
@permission_required('inventory.write')
def admin_inventory_categories_create():
    tenant_id = current_tenant_id()
    actor_id = _current_user_id()
    data = request.get_json() or {}

    name = str(data.get('name') or '').strip()
    description = str(data.get('description') or '').strip()

    if not name:
        return jsonify({"error": "name es requerido"}), 400

    # Check for duplicate name
    existing = _tenant_scoped_query(ProductCategory, tenant_id).filter_by(name=name).first()
    if existing:
        return jsonify({"error": "Ya existe una categoria con ese nombre"}), 409

    category = ProductCategory(
        tenant_id=tenant_id,
        name=name,
        description=description,
        created_by=actor_id,
    )
    db.session.add(category)
    db.session.commit()
    payload = category.to_dict()
    _audit("inventory_category_create", entity_type="inventory_category", entity_id=category.id, metadata=payload)
    return jsonify({"success": True, "category": payload}), 201



@admin_bp.route('/admin/inventory/categories/<int:category_id>', methods=['PATCH'])
@permission_required('inventory.write')
def admin_inventory_categories_update(category_id):
    tenant_id = current_tenant_id()
    actor_id = _current_user_id()
    category = _tenant_scoped_query(ProductCategory, tenant_id).filter_by(id=category_id).first()
    if not category:
        return jsonify({"error": "Categoria no encontrada"}), 404

    data = request.get_json() or {}
    if 'name' in data:
        name = str(data.get('name') or '').strip()
        if not name:
            return jsonify({"error": "name no puede estar vacio"}), 400
        # Check for duplicate name
        existing = _tenant_scoped_query(ProductCategory, tenant_id).filter_by(name=name).filter(ProductCategory.id != category_id).first()
        if existing:
            return jsonify({"error": "Ya existe una categoria con ese nombre"}), 409
        category.name = name
    if 'description' in data:
        category.description = str(data.get('description') or '').strip()

    db.session.add(category)
    db.session.commit()
    payload = category.to_dict()
    _audit("inventory_category_update", entity_type="inventory_category", entity_id=category.id, metadata={"changes": list(data.keys())})
    return jsonify({"success": True, "category": payload}), 200



@admin_bp.route('/admin/inventory/categories/<int:category_id>', methods=['DELETE'])
@permission_required('inventory.write')
def admin_inventory_categories_delete(category_id):
    tenant_id = current_tenant_id()
    category = _tenant_scoped_query(ProductCategory, tenant_id).filter_by(id=category_id).first()
    if not category:
        return jsonify({"error": "Categoria no encontrada"}), 404

    # Check if category is used by products
    products_count = _tenant_scoped_query(Product, tenant_id).filter_by(category_id=category_id).count()
    if products_count > 0:
        return jsonify({"error": f"No se puede eliminar categoria con {products_count} productos asociados"}), 409

    payload = category.to_dict()
    db.session.delete(category)
    db.session.commit()
    _audit("inventory_category_delete", entity_type="inventory_category", entity_id=category_id, metadata=payload)
    return jsonify({"success": True}), 200



@admin_bp.route('/admin/inventory/suppliers', methods=['GET'])
@permission_required('inventory.read')
def admin_inventory_suppliers_list():
    tenant_id = current_tenant_id()
    query = _tenant_scoped_query(Supplier, tenant_id)
    items = [row.to_dict() for row in query.order_by(Supplier.name.asc()).all()]
    return jsonify({"items": items, "count": len(items)}), 200



@admin_bp.route('/admin/inventory/suppliers', methods=['POST'])
@permission_required('inventory.write')
def admin_inventory_suppliers_create():
    tenant_id = current_tenant_id()
    actor_id = _current_user_id()
    data = request.get_json() or {}

    name = str(data.get('name') or '').strip()
    contact_name = str(data.get('contact_name') or '').strip()
    email = str(data.get('email') or '').strip()
    phone = str(data.get('phone') or '').strip()
    address = str(data.get('address') or '').strip()
    notes = str(data.get('notes') or '').strip()

    if not name:
        return jsonify({"error": "name es requerido"}), 400

    # Check for duplicate name
    existing = _tenant_scoped_query(Supplier, tenant_id).filter_by(name=name).first()
    if existing:
        return jsonify({"error": "Ya existe un proveedor con ese nombre"}), 409

    supplier = Supplier(
        tenant_id=tenant_id,
        name=name,
        contact_name=contact_name,
        email=email,
        phone=phone,
        address=address,
        notes=notes,
        created_by=actor_id,
    )
    db.session.add(supplier)
    db.session.commit()
    payload = supplier.to_dict()
    _audit("inventory_supplier_create", entity_type="inventory_supplier", entity_id=supplier.id, metadata=payload)
    return jsonify({"success": True, "supplier": payload}), 201



@admin_bp.route('/admin/inventory/suppliers/<int:supplier_id>', methods=['PATCH'])
@permission_required('inventory.write')
def admin_inventory_suppliers_update(supplier_id):
    tenant_id = current_tenant_id()
    actor_id = _current_user_id()
    supplier = _tenant_scoped_query(Supplier, tenant_id).filter_by(id=supplier_id).first()
    if not supplier:
        return jsonify({"error": "Proveedor no encontrado"}), 404

    data = request.get_json() or {}
    if 'name' in data:
        name = str(data.get('name') or '').strip()
        if not name:
            return jsonify({"error": "name no puede estar vacio"}), 400
        # Check for duplicate name
        existing = _tenant_scoped_query(Supplier, tenant_id).filter_by(name=name).filter(Supplier.id != supplier_id).first()
        if existing:
            return jsonify({"error": "Ya existe un proveedor con ese nombre"}), 409
        supplier.name = name
    if 'contact_name' in data:
        supplier.contact_name = str(data.get('contact_name') or '').strip()
    if 'email' in data:
        supplier.email = str(data.get('email') or '').strip()
    if 'phone' in data:
        supplier.phone = str(data.get('phone') or '').strip()
    if 'address' in data:
        supplier.address = str(data.get('address') or '').strip()
    if 'notes' in data:
        supplier.notes = str(data.get('notes') or '').strip()

    db.session.add(supplier)
    db.session.commit()
    payload = supplier.to_dict()
    _audit("inventory_supplier_update", entity_type="inventory_supplier", entity_id=supplier.id, metadata={"changes": list(data.keys())})
    return jsonify({"success": True, "supplier": payload}), 200



@admin_bp.route('/admin/inventory/suppliers/<int:supplier_id>', methods=['DELETE'])
@permission_required('inventory.write')
def admin_inventory_suppliers_delete(supplier_id):
    tenant_id = current_tenant_id()
    supplier = _tenant_scoped_query(Supplier, tenant_id).filter_by(id=supplier_id).first()
    if not supplier:
        return jsonify({"error": "Proveedor no encontrado"}), 404

    # Check if supplier is used by products
    products_count = _tenant_scoped_query(Product, tenant_id).filter_by(supplier_id=supplier_id).count()
    if products_count > 0:
        return jsonify({"error": f"No se puede eliminar proveedor con {products_count} productos asociados"}), 409

    payload = supplier.to_dict()
    db.session.delete(supplier)
    db.session.commit()
    _audit("inventory_supplier_delete", entity_type="inventory_supplier", entity_id=supplier_id, metadata=payload)
    return jsonify({"success": True}), 200



@admin_bp.route('/admin/inventory/products', methods=['GET'])
@permission_required('inventory.read')
def admin_inventory_products_list():
    tenant_id = current_tenant_id()
    category_id = _parse_int(request.args.get('category_id'))
    supplier_id = _parse_int(request.args.get('supplier_id'))
    low_stock = _parse_bool(request.args.get('low_stock'))

    query = _tenant_scoped_query(Product, tenant_id).options(joinedload(Product.category), joinedload(Product.supplier))
    if category_id is not None:
        query = query.filter_by(category_id=category_id)
    if supplier_id is not None:
        query = query.filter_by(supplier_id=supplier_id)
    if low_stock:
        query = query.filter(Product.current_stock <= Product.min_stock_level)

    items = [row.to_dict() for row in query.order_by(Product.name.asc()).all()]
    return jsonify({"items": items, "count": len(items)}), 200



@admin_bp.route('/admin/inventory/products', methods=['POST'])
@permission_required('inventory.write')
def admin_inventory_products_create():
    tenant_id = current_tenant_id()
    actor_id = _current_user_id()
    data = request.get_json() or {}

    name = str(data.get('name') or '').strip()
    sku = str(data.get('sku') or '').strip()
    category_id = _parse_int(data.get('category_id'))
    supplier_id = _parse_int(data.get('supplier_id'))
    description = str(data.get('description') or '').strip()
    unit_cost = _parse_money_value(data.get('unit_cost'))
    unit_price = _parse_money_value(data.get('unit_price'))
    current_stock = _parse_int(data.get('current_stock')) or 0
    min_stock_level = _parse_int(data.get('min_stock_level')) or 0
    max_stock_level = _parse_int(data.get('max_stock_level')) or 0
    location = str(data.get('location') or '').strip()

    if not name:
        return jsonify({"error": "name es requerido"}), 400
    if category_id is not None:
        category = _tenant_scoped_query(ProductCategory, tenant_id).filter_by(id=category_id).first()
        if not category:
            return jsonify({"error": "Categoria no encontrada"}), 404
    if supplier_id is not None:
        supplier = _tenant_scoped_query(Supplier, tenant_id).filter_by(id=supplier_id).first()
        if not supplier:
            return jsonify({"error": "Proveedor no encontrado"}), 404

    # Check for duplicate SKU
    if sku:
        existing = _tenant_scoped_query(Product, tenant_id).filter_by(sku=sku).first()
        if existing:
            return jsonify({"error": "Ya existe un producto con ese SKU"}), 409

    product = Product(
        tenant_id=tenant_id,
        name=name,
        sku=sku,
        category_id=category_id,
        supplier_id=supplier_id,
        description=description,
        unit_cost=unit_cost,
        unit_price=unit_price,
        current_stock=current_stock,
        min_stock_level=min_stock_level,
        max_stock_level=max_stock_level,
        location=location,
        created_by=actor_id,
    )
    db.session.add(product)
    db.session.commit()
    payload = product.to_dict()
    _audit("inventory_product_create", entity_type="inventory_product", entity_id=product.id, metadata=payload)
    return jsonify({"success": True, "product": payload}), 201



@admin_bp.route('/admin/inventory/products/<int:product_id>', methods=['PATCH'])
@permission_required('inventory.write')
def admin_inventory_products_update(product_id):
    tenant_id = current_tenant_id()
    actor_id = _current_user_id()
    product = _tenant_scoped_query(Product, tenant_id).filter_by(id=product_id).first()
    if not product:
        return jsonify({"error": "Producto no encontrado"}), 404

    data = request.get_json() or {}
    if 'name' in data:
        name = str(data.get('name') or '').strip()
        if not name:
            return jsonify({"error": "name no puede estar vacio"}), 400
        product.name = name
    if 'sku' in data:
        sku = str(data.get('sku') or '').strip()
        if sku:
            # Check for duplicate SKU
            existing = _tenant_scoped_query(Product, tenant_id).filter_by(sku=sku).filter(Product.id != product_id).first()
            if existing:
                return jsonify({"error": "Ya existe un producto con ese SKU"}), 409
        product.sku = sku
    if 'category_id' in data:
        category_id = _parse_int(data.get('category_id'))
        if category_id is not None:
            category = _tenant_scoped_query(ProductCategory, tenant_id).filter_by(id=category_id).first()
            if not category:
                return jsonify({"error": "Categoria no encontrada"}), 404
        product.category_id = category_id
    if 'supplier_id' in data:
        supplier_id = _parse_int(data.get('supplier_id'))
        if supplier_id is not None:
            supplier = _tenant_scoped_query(Supplier, tenant_id).filter_by(id=supplier_id).first()
            if not supplier:
                return jsonify({"error": "Proveedor no encontrado"}), 404
        product.supplier_id = supplier_id
    if 'description' in data:
        product.description = str(data.get('description') or '').strip()
    if 'unit_cost' in data:
        product.unit_cost = _parse_money_value(data.get('unit_cost'))
    if 'unit_price' in data:
        product.unit_price = _parse_money_value(data.get('unit_price'))
    if 'current_stock' in data:
        product.current_stock = _parse_int(data.get('current_stock')) or 0
    if 'min_stock_level' in data:
        product.min_stock_level = _parse_int(data.get('min_stock_level')) or 0
    if 'max_stock_level' in data:
        product.max_stock_level = _parse_int(data.get('max_stock_level')) or 0
    if 'location' in data:
        product.location = str(data.get('location') or '').strip()

    db.session.add(product)
    db.session.commit()
    payload = product.to_dict()
    _audit("inventory_product_update", entity_type="inventory_product", entity_id=product.id, metadata={"changes": list(data.keys())})
    return jsonify({"success": True, "product": payload}), 200



@admin_bp.route('/admin/inventory/products/<int:product_id>', methods=['DELETE'])
@permission_required('inventory.write')
def admin_inventory_products_delete(product_id):
    tenant_id = current_tenant_id()
    product = _tenant_scoped_query(Product, tenant_id).filter_by(id=product_id).first()
    if not product:
        return jsonify({"error": "Producto no encontrado"}), 404

    # Check if product has movements
    movements_count = _tenant_scoped_query(InventoryMovement, tenant_id).filter_by(product_id=product_id).count()
    if movements_count > 0:
        return jsonify({"error": f"No se puede eliminar producto con {movements_count} movimientos asociados"}), 409

    payload = product.to_dict()
    db.session.delete(product)
    db.session.commit()
    _audit("inventory_product_delete", entity_type="inventory_product", entity_id=product_id, metadata=payload)
    return jsonify({"success": True}), 200



@admin_bp.route('/admin/inventory/movements', methods=['GET'])
@permission_required('inventory.read')
def admin_inventory_movements_list():
    tenant_id = current_tenant_id()
    product_id = _parse_int(request.args.get('product_id'))
    movement_type = str(request.args.get('type') or '').strip().lower()
    start_date = _parse_iso_datetime(request.args.get('start_date'))
    end_date = _parse_iso_datetime(request.args.get('end_date'))

    query = _tenant_scoped_query(InventoryMovement, tenant_id).options(joinedload(InventoryMovement.product))
    if product_id is not None:
        query = query.filter_by(product_id=product_id)
    if movement_type and movement_type in {'in', 'out', 'adjustment'}:
        query = query.filter_by(movement_type=movement_type)
    if start_date:
        query = query.filter(InventoryMovement.created_at >= start_date)
    if end_date:
        query = query.filter(InventoryMovement.created_at <= end_date)

    items = [row.to_dict() for row in query.order_by(InventoryMovement.created_at.desc()).limit(500).all()]
    return jsonify({"items": items, "count": len(items)}), 200



@admin_bp.route('/admin/inventory/movements', methods=['POST'])
@permission_required('inventory.write')
def admin_inventory_movements_create():
    tenant_id = current_tenant_id()
    actor_id = _current_user_id()
    data = request.get_json() or {}

    product_id = _parse_int(data.get('product_id'))
    movement_type = str(data.get('movement_type') or '').strip().lower()
    quantity = _parse_int(data.get('quantity'))
    unit_cost = _parse_money_value(data.get('unit_cost'))
    notes = str(data.get('notes') or '').strip()

    if product_id is None:
        return jsonify({"error": "product_id es requerido"}), 400
    if movement_type not in {'in', 'out', 'adjustment'}:
        return jsonify({"error": "movement_type debe ser 'in', 'out' o 'adjustment'"}), 400
    if quantity is None or quantity <= 0:
        return jsonify({"error": "quantity debe ser mayor a 0"}), 400

    product = _tenant_scoped_query(Product, tenant_id).filter_by(id=product_id).first()
    if not product:
        return jsonify({"error": "Producto no encontrado"}), 404

    # Calculate new stock
    if movement_type == 'in':
        new_stock = product.current_stock + quantity
    elif movement_type == 'out':
        if product.current_stock < quantity:
            return jsonify({"error": f"Stock insuficiente. Disponible: {product.current_stock}"}), 409
        new_stock = product.current_stock - quantity
    else:  # adjustment
        new_stock = quantity

    movement = InventoryMovement(
        tenant_id=tenant_id,
        product_id=product_id,
        movement_type=movement_type,
        quantity=quantity,
        previous_stock=product.current_stock,
        new_stock=new_stock,
        unit_cost=unit_cost,
        notes=notes,
        created_by=actor_id,
    )
    product.current_stock = new_stock

    db.session.add(movement)
    db.session.add(product)
    db.session.commit()
    payload = movement.to_dict()
    _audit("inventory_movement_create", entity_type="inventory_movement", entity_id=movement.id, metadata=payload)
    return jsonify({"success": True, "movement": payload, "product": product.to_dict()}), 201



@admin_bp.route('/admin/inventory/movements/<int:movement_id>', methods=['PATCH'])
@permission_required('inventory.write')
def admin_inventory_movements_update(movement_id):
    tenant_id = current_tenant_id()
    movement = _tenant_scoped_query(InventoryMovement, tenant_id).filter_by(id=movement_id).first()
    if not movement:
        return jsonify({"error": "Movimiento no encontrado"}), 404

    data = request.get_json() or {}
    if 'notes' in data:
        movement.notes = str(data.get('notes') or '').strip()

    db.session.add(movement)
    db.session.commit()
    payload = movement.to_dict()
    _audit("inventory_movement_update", entity_type="inventory_movement", entity_id=movement.id, metadata={"changes": list(data.keys())})
    return jsonify({"success": True, "movement": payload}), 200



@admin_bp.route('/admin/inventory/movements/<int:movement_id>', methods=['DELETE'])
@permission_required('inventory.write')
def admin_inventory_movements_delete(movement_id):
    tenant_id = current_tenant_id()
    movement = _tenant_scoped_query(InventoryMovement, tenant_id).filter_by(id=movement_id).first()
    if not movement:
        return jsonify({"error": "Movimiento no encontrado"}), 404

    # Reverse the stock change
    product = _tenant_scoped_query(Product, tenant_id).filter_by(id=movement.product_id).first()
    if product:
        if movement.movement_type == 'in':
            product.current_stock -= movement.quantity
        elif movement.movement_type == 'out':
            product.current_stock += movement.quantity
        else:  # adjustment
            product.current_stock = movement.previous_stock
        db.session.add(product)

    payload = movement.to_dict()
    db.session.delete(movement)
    db.session.commit()
    _audit("inventory_movement_delete", entity_type="inventory_movement", entity_id=movement_id, metadata=payload)
    return jsonify({"success": True}), 200



@admin_bp.route('/admin/inventory/reports/low-stock', methods=['GET'])
@permission_required('inventory.read')
def admin_inventory_reports_low_stock():
    tenant_id = current_tenant_id()
    query = _tenant_scoped_query(Product, tenant_id).options(joinedload(Product.category), joinedload(Product.supplier))
    query = query.filter(Product.current_stock <= Product.min_stock_level)

    items = [row.to_dict() for row in query.order_by((Product.min_stock_level - Product.current_stock).desc()).all()]
    summary = {
        "total_low_stock": len(items),
        "critical_count": sum(1 for item in items if item.get('current_stock', 0) == 0),
        "warning_count": sum(1 for item in items if 0 < item.get('current_stock', 0) <= item.get('min_stock_level', 0)),
    }
    return jsonify({"items": items, "count": len(items), "summary": summary}), 200



@admin_bp.route('/admin/inventory/reports/stock-value', methods=['GET'])
@permission_required('inventory.read')
def admin_inventory_reports_stock_value():
    tenant_id = current_tenant_id()
    products = _tenant_scoped_query(Product, tenant_id).options(joinedload(Product.category)).all()

    total_value = 0.0
    items = []
    for product in products:
        value = float(product.current_stock or 0) * float(product.unit_cost or 0)
        total_value += value
        items.append({
            "product_id": product.id,
            "product_name": product.name,
            "sku": product.sku,
            "category": product.category.name if product.category else None,
            "current_stock": product.current_stock,
            "unit_cost": product.unit_cost,
            "total_value": round(value, 2),
        })

    items.sort(key=lambda x: x['total_value'], reverse=True)
    return jsonify({
        "items": items,
        "count": len(items),
        "summary": {
            "total_value": round(total_value, 2),
            "total_products": len(products),
            "products_with_stock": sum(1 for p in products if p.current_stock > 0),
        }
    }), 200



@admin_bp.route('/admin/inventory/reports/movements-summary', methods=['GET'])
@permission_required('inventory.read')
def admin_inventory_reports_movements_summary():
    tenant_id = current_tenant_id()
    start_date = _parse_iso_datetime(request.args.get('start_date'))
    end_date = _parse_iso_datetime(request.args.get('end_date'))

    if not start_date:
        start_date = datetime.now(timezone.utc).replace(day=1)  # First day of current month
    if not end_date:
        end_date = datetime.now(timezone.utc)

    query = _tenant_scoped_query(InventoryMovement, tenant_id)
    query = query.filter(InventoryMovement.created_at >= start_date, InventoryMovement.created_at <= end_date)

    movements = query.all()
    summary = {
        "period": {
            "start_date": start_date.isoformat() + "Z",
            "end_date": end_date.isoformat() + "Z",
        },
        "totals": {
            "in": sum(m.quantity for m in movements if m.movement_type == 'in'),
            "out": sum(m.quantity for m in movements if m.movement_type == 'out'),
            "adjustments": sum(m.quantity for m in movements if m.movement_type == 'adjustment'),
        },
        "movements_count": len(movements),
        "products_affected": len(set(m.product_id for m in movements)),
    }
    return jsonify(summary), 200

# ─────────────────────────────────────────────────────────────────────────────
# Fase 4: Operación a Escala e Infraestructura GIS
# ─────────────────────────────────────────────────────────────────────────────


@admin_bp.route('/admin/inventory/units', methods=['GET'])
@permission_required('inventory.read')
def admin_inventory_list_units():
    tenant_id = current_tenant_id()
    serial = request.args.get('serial', '').strip()
    status = request.args.get('status', '').strip()
    product_id = _parse_int(request.args.get('product_id'))

    query = _tenant_scoped_query(ProductUnit, tenant_id)
    if serial:
        query = query.filter(ProductUnit.serial_number.ilike(f"%{serial}%"))
    if status:
        query = query.filter(ProductUnit.status == status)
    if product_id:
        query = query.filter(ProductUnit.product_id == product_id)

    units = query.all()
    return jsonify({"items": [u.to_dict() for u in units], "count": len(units)}), 200



@admin_bp.route('/admin/inventory/units', methods=['POST'])
@permission_required('inventory.write')
def admin_inventory_create_unit():
    tenant_id = current_tenant_id()
    data = request.get_json() or {}
    
    unit = ProductUnit(
        product_id=data.get('product_id'),
        serial_number=data.get('serial_number'),
        mac_address=data.get('mac_address'),
        status=data.get('status', 'available'),
        total_length=data.get('total_length'),
        remaining_length=data.get('remaining_length') or data.get('total_length'),
        notes=data.get('notes'),
        tenant_id=tenant_id
    )

    db.session.add(unit)
    
    # Update product stock automatically
    product = db.session.get(Product, unit.product_id)
    if product:
        product.stock_quantity += 1
        
    db.session.commit()
    return jsonify(unit.to_dict()), 201



