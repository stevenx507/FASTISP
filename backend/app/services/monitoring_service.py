from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import SYNCHRONOUS
from influxdb_client.client.exceptions import InfluxDBError
from flask import current_app

class MonitoringService:
    def __init__(self):
        self.influx_url = current_app.config['INFLUXDB_URL']
        self.influx_token = current_app.config['INFLUXDB_TOKEN']
        self.influx_org = current_app.config['INFLUXDB_ORG']
        self.influx_bucket = current_app.config['INFLUXDB_BUCKET']
        
        self.client = InfluxDBClient(url=self.influx_url, token=self.influx_token, org=self.influx_org)
        self.write_api = self.client.write_api(write_options=SYNCHRONOUS)
        self.query_api = self.client.query_api()

    def write_metric(self, measurement: str, fields: dict, tags: dict = None):
        """
        Writes a single data point to InfluxDB.

        :param measurement: The name of the measurement (e.g., 'cpu_load').
        :param fields: A dictionary of field keys and values (e.g., {'value': 0.75}).
        :param tags: A dictionary of tags to apply to the data point (e.g., {'device': 'router1'}).
        """
        if not fields:
            current_app.logger.warning(f"Attempted to write metric '{measurement}' with no fields.")
            return

        point = Point(measurement)
        
        if tags:
            for key, value in tags.items():
                point.tag(key, value)
        
        for key, value in fields.items():
            # InfluxDB requires field values to be float, int, bool or str.
            try:
                # Attempt to cast to float if possible, otherwise keep original type
                field_value = float(value)
            except (ValueError, TypeError):
                field_value = value
            point.field(key, field_value)
            
        try:
            self.write_api.write(bucket=self.influx_bucket, org=self.influx_org, record=point)
            current_app.logger.debug(f"Successfully wrote metric '{measurement}' with tags {tags} and fields {fields}")
        except Exception as e:
            current_app.logger.error(f"Failed to write metric to InfluxDB: {e}")

    def query_metrics(self, measurement: str, time_range: str = '-1h', tags: dict = None, fields: list = None) -> list:
        """
        Queries time-series data from InfluxDB.

        :param measurement: The measurement to query.
        :param time_range: The time range to query (e.g., '-1h', '-24h', '-7d'). Defaults to '-1h'.
        :param tags: A dictionary of tags to filter by.
        :param fields: A list of specific fields to return. If None, returns all fields.
        :return: A list of dictionaries, where each dictionary represents a data point.
        """
        try:
            query_parts = [
                f'from(bucket: "{self.influx_bucket}")',
                f'|> range(start: {time_range})',
                f'|> filter(fn: (r) => r._measurement == "{measurement}")'
            ]

            if tags:
                for key, value in tags.items():
                    query_parts.append(f'|> filter(fn: (r) => r.{key} == "{value}")')
            
            if fields:
                field_filters = " or ".join([f'r._field == "{field}"' for field in fields])
                query_parts.append(f'|> filter(fn: (r) => {field_filters})')

            # Pivot the data to group fields into columns for each timestamp
            query_parts.append('|> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")')
            
            flux_query = "\n".join(query_parts)
            current_app.logger.debug(f"Executing Flux query:\n{flux_query}")

            result = self.query_api.query(query=flux_query, org=self.influx_org)
            
            # Process the result into a simple list of dictionaries
            records = []
            for table in result:
                for record in table.records:
                    # The record is a dictionary-like object. We can convert it to a plain dict.
                    # We also convert the time to a standard ISO format string.
                    record_dict = record.values
                    record_dict['_time'] = record.get_time().isoformat()
                    records.append(record_dict)
            
            return records
        except InfluxDBError as e:
            current_app.logger.error(f"Error querying InfluxDB: {e._message}")
            return []
        except Exception as e:
            current_app.logger.error(f"An unexpected error occurred during query: {e}")
            return []

    def latest_point(self, measurement: str, tags: dict = None) -> dict:
        """
        Fetch the most recent point for a measurement (optionally filtered by tags).
        Useful to drive live dashboards without pulling full series.
        """
        try:
            query_parts = [
                f'from(bucket: "{self.influx_bucket}")',
                f'|> range(start: -2d)',
                f'|> filter(fn: (r) => r._measurement == "{measurement}")',
            ]

            if tags:
                for key, value in tags.items():
                    query_parts.append(f'|> filter(fn: (r) => r.{key} == "{value}")')

            query_parts.append('|> sort(columns: ["_time"], desc: true)')
            query_parts.append('|> limit(n:1)')
            query_parts.append('|> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")')

            flux_query = "\n".join(query_parts)
            current_app.logger.debug(f"Executing latest_point query:\n{flux_query}")
            result = self.query_api.query(query=flux_query, org=self.influx_org)
            for table in result:
                for record in table.records:
                    record_dict = record.values
                    record_dict['_time'] = record.get_time().isoformat()
                    return record_dict
            return {}
        except Exception as e:
            current_app.logger.error(f"Failed to fetch latest point for {measurement}: {e}")
            return {}


class _LazyMonitoringService:
    def __init__(self):
        self._svc = None

    def _ensure(self):
        if self._svc is None:
            self._svc = MonitoringService()

    def write_metric(self, measurement: str, fields: dict, tags: dict = None):
        self._ensure()
        return self._svc.write_metric(measurement, fields, tags)

    def query_metrics(self, measurement: str, time_range: str = '-1h', tags: dict = None, fields: list = None):
        self._ensure()
        return self._svc.query_metrics(measurement, time_range, tags, fields)


# Lazy singleton used by routes/tasks; initializes when first used under an app context
monitoring_service = _LazyMonitoringService()
