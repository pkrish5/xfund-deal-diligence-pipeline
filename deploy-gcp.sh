#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 XFund Deal Pipeline - Google Cloud Deployer${NC}"
echo "---------------------------------------------"

# 1. Check Prerequisites
echo -e "\n${YELLOW}Checks:${NC}"
command -v gcloud >/dev/null 2>&1 || { echo -e "${RED}❌ gcloud CLI is not installed.${NC} Please install it first."; exit 1; }
command -v terraform >/dev/null 2>&1 || { echo -e "${RED}❌ terraform is not installed.${NC} Please install it first."; exit 1; }
command -v docker >/dev/null 2>&1 || { echo -e "${RED}❌ docker is not installed.${NC} Please install it first."; exit 1; }
echo -e "${GREEN}✅ All tools found.${NC}"

# 2. Project Setup
if [ -z "$1" ]; then
    read -p "Enter your GCP Project ID: " PROJECT_ID
else
    PROJECT_ID=$1
fi

if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}Project ID is required.${NC}"
    exit 1
fi

echo -e "\n${YELLOW}Setting project to $PROJECT_ID...${NC}"
gcloud config set project $PROJECT_ID

# 3. Enable APIs
echo -e "\n${YELLOW}Enabling required GCP APIs...${NC}"
gcloud services enable \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    artifactregistry.googleapis.com \
    cloudtasks.googleapis.com \
    cloudscheduler.googleapis.com \
    secretmanager.googleapis.com \
    sqladmin.googleapis.com \
    compute.googleapis.com \
    iam.googleapis.com --quiet

# 4. TFVars Check
TF_DIR="infra/terraform"
if [ ! -f "$TF_DIR/terraform.tfvars" ]; then
    echo -e "\n${RED}⚠️  No terraform.tfvars found!${NC}"
    if [ -f "$TF_DIR/terraform.tfvars.example" ]; then
        cp "$TF_DIR/terraform.tfvars.example" "$TF_DIR/terraform.tfvars"
        echo -e "${GREEN}Created $TF_DIR/terraform.tfvars from example.${NC}"
        echo -e "${YELLOW}👉 Please open $TF_DIR/terraform.tfvars, fill in your secrets, and run this script again.${NC}"
        exit 1
    else
        echo -e "${RED}Missing example file too. Please create terraform.tfvars manually.${NC}"
        exit 1
    fi
fi

# 5. Docker Build & Push
echo -e "\n${YELLOW}Configuring Docker credentials...${NC}"
gcloud auth configure-docker --quiet

echo -e "\n${YELLOW}Building and Pushing Docker images...${NC}"
# Use standard gcr.io
INGRESS_IMG="gcr.io/$PROJECT_ID/diligence-ingress:latest"
ADMIN_IMG="gcr.io/$PROJECT_ID/diligence-admin:latest"
WORKER_IMG="gcr.io/$PROJECT_ID/diligence-worker:latest"

echo "Building Ingress..."
docker build -t $INGRESS_IMG -f apps/ingress/Dockerfile . --platform linux/amd64
docker push $INGRESS_IMG

echo "Building Admin..."
docker build -t $ADMIN_IMG -f apps/admin/Dockerfile . --platform linux/amd64
docker push $ADMIN_IMG

echo "Building Worker..."
docker build -t $WORKER_IMG -f apps/worker/Dockerfile . --platform linux/amd64
docker push $WORKER_IMG

# 6. Terraform Apply
echo -e "\n${YELLOW}Deploying Infrastructure via Terraform...${NC}"
cd $TF_DIR
terraform init

echo -e "${GREEN}Applying Terraform...${NC}"
# Pass image names securely via var arguments to override defaults
terraform apply \
  -var="project_id=$PROJECT_ID" \
  -var="ingress_image=$INGRESS_IMG" \
  -var="admin_image=$ADMIN_IMG" \
  -var="worker_image=$WORKER_IMG" \
  -auto-approve

# 7. Post-Deploy Info
echo -e "\n${GREEN}✅ Deployment Complete!${NC}"
echo "---------------------------------------------"
echo "Check the outputs above for your Service URLs."
echo "Don't forget to:"
echo "1. Run database migrations if this is a fresh DB."
echo "2. Update your Asana Webhook and GCal Watch to point to the new Ingress URL."
