from flask import jsonify
from . import billing_bp

@billing_bp.route('/vouchers', methods=['GET'])
def list_vouchers_placeholder():
    return jsonify({"items": [], "message": "Voucher system under maintenance"}), 200
