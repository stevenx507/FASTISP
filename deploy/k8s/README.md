# Kubernetes Deployment (Scale Profile)

## Apply base resources
```bash
kubectl apply -f deploy/k8s/00-namespace.yaml
kubectl -n ispfast create secret generic ispfast-secrets \
  --from-literal=DATABASE_URL='postgresql://user:pass@postgres/ispfast' \
  --from-literal=REDIS_URL='redis://ispfast-redis:6379/0' \
  --from-literal=SECRET_KEY='replace_with_32_plus_chars_secret_key' \
  --from-literal=JWT_SECRET_KEY='replace_with_32_plus_chars_jwt_secret' \
  --from-literal=ENCRYPTION_KEY='replace_with_fernet_key' \
  --from-literal=MIKROTIK_DEFAULT_USERNAME='admin' \
  --from-literal=MIKROTIK_DEFAULT_PASSWORD='replace_me'
```

## Deploy services
```bash
kubectl apply -f deploy/k8s/40-redis.yaml
kubectl apply -f deploy/k8s/10-backend.yaml
kubectl apply -f deploy/k8s/20-worker.yaml
kubectl apply -f deploy/k8s/30-frontend.yaml
```

## Verify
```bash
kubectl -n ispfast get pods
kubectl -n ispfast get hpa
kubectl -n ispfast get svc
```

## Recommended production add-ons
- Managed PostgreSQL with read replicas
- Ingress + TLS (Nginx/Traefik)
- External metrics adapter for custom HPA signals
- Centralized logging (Loki/ELK) and traces (OTel)
