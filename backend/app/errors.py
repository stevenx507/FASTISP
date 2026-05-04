from flask import jsonify, current_app
from werkzeug.exceptions import HTTPException

def register_error_handlers(app):
    """Registra manejadores globales para errores HTTP y excepciones no controladas."""
    
    @app.errorhandler(HTTPException)
    def handle_http_exception(e):
        """Maneja errores HTTP conocidos (404, 405, etc.)."""
        response = e.get_response()
        response.data = jsonify({
            "code": e.code,
            "name": e.name,
            "description": e.description,
            "success": False
        }).data
        response.content_type = "application/json"
        return response

    @app.errorhandler(Exception)
    def handle_unhandled_exception(e):
        """Maneja cualquier otra excepción no capturada (500)."""
        current_app.logger.error(f"Unhandled Exception: {str(e)}", exc_info=True)
        return jsonify({
            "code": 500,
            "name": "Internal Server Error",
            "description": "Ha ocurrido un error inesperado en el servidor.",
            "success": False
        }), 500

    @app.errorhandler(404)
    def handle_404(e):
        return jsonify({
            "error": "Recurso no encontrado",
            "code": 404,
            "success": False
        }), 404

    @app.errorhandler(403)
    def handle_403(e):
        return jsonify({
            "error": "Acceso denegado",
            "code": 403,
            "success": False
        }), 403
