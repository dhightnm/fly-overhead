#!/bin/bash

# Deploy Manager - Handles Docker builds and AWS ECR deployment
# Consolidates: rebuild-docker.sh and setup-ecr.sh

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
REPO_NAME="fly-overhead"

# Print usage
usage() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Deploy Manager - Fly Overhead${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    echo "Usage: ./deploy-manager.sh <command> [options]"
    echo ""
    echo "Commands:"
    echo "  build [mode]            - Build Docker image (dev/prod, default: prod)"
    echo "  rebuild [mode]          - Rebuild Docker containers (dev/prod, default: prod)"
    echo "  push [region]           - Push to AWS ECR (default region: us-east-2)"
    echo "  deploy [region]         - Build and push to ECR"
    echo "  start [mode]            - Start Docker containers"
    echo "  stop [mode]             - Stop Docker containers"
    echo "  logs [mode]             - Show container logs"
    echo ""
    echo "Examples:"
    echo "  ./deploy-manager.sh build"
    echo "  ./deploy-manager.sh build dev"
    echo "  ./deploy-manager.sh rebuild"
    echo "  ./deploy-manager.sh push us-east-2"
    echo "  ./deploy-manager.sh deploy us-east-2"
    echo "  ./deploy-manager.sh deploy-lightsail [service-name] [region]"
    echo "  ./deploy-manager.sh start dev"
    echo ""
}

# Build Docker image
cmd_build() {
    local mode="${1:-prod}"
    
    echo -e "${YELLOW}Building Docker image ($mode mode)...${NC}"
    echo ""
    
    # Get API URL from environment or use default
    local api_url="${REACT_APP_API_URL:-https://container-service-1.f199m4bz801f2.us-east-2.cs.amazonlightsail.com}"
    echo "Using REACT_APP_API_URL: $api_url"
    
    # Get Google Client ID from environment or .env file
    local google_client_id="${REACT_APP_GOOGLE_CLIENT_ID:-}"
    if [ -z "$google_client_id" ] && [ -f .env ]; then
        google_client_id=$(grep "^REACT_APP_GOOGLE_CLIENT_ID=" .env | cut -d '=' -f2- | tr -d '"' | tr -d "'")
    fi
    if [ -n "$google_client_id" ]; then
        echo "Using REACT_APP_GOOGLE_CLIENT_ID: ${google_client_id:0:20}..."
    else
        echo -e "${YELLOW}Warning: REACT_APP_GOOGLE_CLIENT_ID not set${NC}"
    fi
    echo ""
    
    if [ "$mode" = "dev" ]; then
        docker compose -f docker-compose.dev.yml build --pull server
    else
        # Build with REACT_APP_API_URL and REACT_APP_GOOGLE_CLIENT_ID as build arguments
        if [ -n "$google_client_id" ]; then
            docker build \
                --build-arg REACT_APP_API_URL="$api_url" \
                --build-arg REACT_APP_GOOGLE_CLIENT_ID="$google_client_id" \
                --platform linux/amd64 \
                -t fly-overhead-server:latest \
                .
        else
            docker build \
                --build-arg REACT_APP_API_URL="$api_url" \
                --platform linux/amd64 \
                -t fly-overhead-server:latest \
                .
        fi
    fi
    
    if [ $? -eq 0 ]; then
        echo ""
        echo -e "${GREEN}✓ Build successful${NC}"
    else
        echo -e "${RED}✗ Build failed${NC}"
        exit 1
    fi
}

# Rebuild Docker containers (no cache)
cmd_rebuild() {
    local mode="${1:-prod}"
    
    echo -e "${YELLOW}Rebuilding Docker containers ($mode mode)...${NC}"
    echo ""
    
    if [ "$mode" = "dev" ]; then
        echo "Stopping dev containers..."
        docker compose -f docker-compose.dev.yml down
        
        echo "Rebuilding dev containers (no cache)..."
        docker compose -f docker-compose.dev.yml build --no-cache server
        
        echo "Starting dev containers..."
        docker compose -f docker-compose.dev.yml up -d
    else
        echo "Stopping production containers..."
        docker compose down
        
        echo "Rebuilding production containers (no cache)..."
        docker compose build --no-cache --pull server
        
        echo "Starting production containers..."
        docker compose up -d
    fi
    
    if [ $? -eq 0 ]; then
        echo ""
        echo -e "${GREEN}✓ Containers rebuilt and started!${NC}"
        echo ""
        docker compose ps
    else
        echo -e "${RED}✗ Rebuild failed${NC}"
        exit 1
    fi
}

# Push to AWS ECR
cmd_push() {
    local region="${1:-us-east-2}"
    
    echo -e "${YELLOW}Pushing to AWS ECR...${NC}"
    echo ""
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        echo -e "${RED}✗ AWS CLI not installed${NC}"
        echo "Install: brew install awscli"
        exit 1
    fi
    
    # Check credentials
    echo "Checking AWS credentials..."
    if ! aws sts get-caller-identity &> /dev/null; then
        echo -e "${RED}✗ AWS credentials not configured${NC}"
        echo ""
        echo "Configure AWS credentials:"
        echo "  aws configure"
        echo ""
        echo "Or set environment variables:"
        echo "  export AWS_ACCESS_KEY_ID=your-key"
        echo "  export AWS_SECRET_ACCESS_KEY=your-secret"
        echo "  export AWS_DEFAULT_REGION=$region"
        exit 1
    fi
    
    # Get AWS account info
    AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    ECR_URI="$AWS_ACCOUNT_ID.dkr.ecr.$region.amazonaws.com/$REPO_NAME"
    
    echo -e "${GREEN}✓ AWS credentials configured${NC}"
    echo "  Account: $AWS_ACCOUNT_ID"
    echo "  Region: $region"
    echo "  ECR URI: $ECR_URI"
    echo ""
    
    # Create repository if it doesn't exist
    echo "Checking ECR repository..."
    if aws ecr describe-repositories --repository-names "$REPO_NAME" --region "$region" &> /dev/null; then
        echo -e "${GREEN}✓ Repository exists${NC}"
    else
        echo "Creating repository..."
        aws ecr create-repository \
            --repository-name "$REPO_NAME" \
            --region "$region" \
            --image-scanning-configuration scanOnPush=true \
            --image-tag-mutability MUTABLE
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✓ Repository created${NC}"
        else
            echo -e "${RED}✗ Failed to create repository${NC}"
            exit 1
        fi
    fi
    echo ""
    
    # Login to ECR
    echo "Logging in to ECR..."
    aws ecr get-login-password --region "$region" | \
        docker login --username AWS --password-stdin "$ECR_URI"
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}✗ ECR login failed${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Logged in to ECR${NC}"
    echo ""
    
    # Tag image
    echo "Tagging images..."
    TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
    docker tag fly-overhead-server:latest "$ECR_URI:latest"
    docker tag fly-overhead-server:latest "$ECR_URI:$TIMESTAMP"
    echo -e "${GREEN}✓ Images tagged${NC}"
    echo "  - $ECR_URI:latest"
    echo "  - $ECR_URI:$TIMESTAMP"
    echo ""
    
    # Push images
    echo "Pushing images to ECR..."
    echo "(This may take a few minutes...)"
    echo ""
    docker push "$ECR_URI:latest"
    docker push "$ECR_URI:$TIMESTAMP"
    
    if [ $? -eq 0 ]; then
        echo ""
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}✓ Images pushed successfully!${NC}"
        echo -e "${GREEN}========================================${NC}"
        echo ""
        echo "Image URIs:"
        echo "  $ECR_URI:latest"
        echo "  $ECR_URI:$TIMESTAMP"
        echo ""
        echo -e "${BLUE}Next steps for Lightsail:${NC}"
        echo "1. Go to AWS Lightsail Console"
        echo "2. Navigate to Container Services"
        echo "3. Create/update deployment"
        echo "4. Use image: $ECR_URI:latest"
        echo "5. Configure environment variables (see LIGHTSAIL_DEPLOYMENT_GUIDE.md)"
        echo ""
    else
        echo -e "${RED}✗ Push failed${NC}"
        exit 1
    fi
}

# Build and push
cmd_deploy() {
    local region="${1:-us-east-2}"
    
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Full deployment to AWS ECR${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    
    # Build image
    cmd_build prod
    echo ""
    
    # Push to ECR
    cmd_push "$region"
}

# Deploy to Lightsail
cmd_deploy_lightsail() {
    local service_name="${1:-container-service-1}"
    local region="${2:-us-east-2}"
    
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Deploy to AWS Lightsail${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    
    # Get AWS account info
    AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    ECR_URI="$AWS_ACCOUNT_ID.dkr.ecr.$region.amazonaws.com/$REPO_NAME"
    IMAGE_URI="$ECR_URI:latest"
    
    echo "Service: $service_name"
    echo "Region: $region"
    echo "Image: $IMAGE_URI"
    echo ""
    
    # Get current deployment to preserve environment variables
    echo "Fetching current deployment configuration..."
    CURRENT_DEPLOYMENT=$(aws lightsail get-container-services \
        --service-name "$service_name" \
        --region "$region" \
        --query 'containerServices[0].currentDeployment' \
        --output json)
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}✗ Failed to get current deployment${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Got current deployment${NC}"
    echo ""
    
    # Create new deployment
    echo "Creating new deployment..."
    DEPLOYMENT_OUTPUT=$(aws lightsail create-container-service-deployment \
        --service-name "$service_name" \
        --region "$region" \
        --cli-input-json "{
            \"containers\": {
                \"flyoverheadapp\": {
                    \"image\": \"$IMAGE_URI\",
                    \"environment\": $(echo "$CURRENT_DEPLOYMENT" | jq -r '.containers.flyoverheadapp.environment // {}'),
                    \"ports\": {
                        \"3005\": \"HTTP\"
                    }
                }
            },
            \"publicEndpoint\": {
                \"containerName\": \"flyoverheadapp\",
                \"containerPort\": 3005,
                \"healthCheck\": {
                    \"healthyThreshold\": 2,
                    \"unhealthyThreshold\": 2,
                    \"timeoutSeconds\": 5,
                    \"intervalSeconds\": 30,
                    \"path\": \"/health\",
                    \"successCodes\": \"200\"
                }
            }
        }" 2>&1)
    
    if [ $? -eq 0 ]; then
        NEW_VERSION=$(echo "$DEPLOYMENT_OUTPUT" | jq -r '.containerService.nextDeployment.version // .containerService.currentDeployment.version')
        echo -e "${GREEN}✓ Deployment initiated (version: $NEW_VERSION)${NC}"
        echo ""
        echo -e "${BLUE}Deployment is in progress. Monitor at:${NC}"
        echo "https://lightsail.aws.amazon.com/ls/webapp/$region/container-services/$service_name"
        echo ""
        echo "Or check status with:"
        echo "  aws lightsail get-container-services --service-name $service_name --region $region --query 'containerServices[0].{state: state, currentVersion: currentDeployment.version, nextVersion: nextDeployment.version, nextState: nextDeployment.state}'"
    else
        echo -e "${RED}✗ Deployment failed${NC}"
        echo "$DEPLOYMENT_OUTPUT"
        exit 1
    fi
}

# Start containers
cmd_start() {
    local mode="${1:-prod}"
    
    echo -e "${YELLOW}Starting containers ($mode mode)...${NC}"
    
    if [ "$mode" = "dev" ]; then
        docker compose -f docker-compose.dev.yml up -d
    else
        docker compose up -d
    fi
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Containers started${NC}"
        echo ""
        docker compose ps
    fi
}

# Stop containers
cmd_stop() {
    local mode="${1:-prod}"
    
    echo -e "${YELLOW}Stopping containers ($mode mode)...${NC}"
    
    if [ "$mode" = "dev" ]; then
        docker compose -f docker-compose.dev.yml down
    else
        docker compose down
    fi
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Containers stopped${NC}"
    fi
}

# Show logs
cmd_logs() {
    local mode="${1:-prod}"
    
    if [ "$mode" = "dev" ]; then
        docker compose -f docker-compose.dev.yml logs -f
    else
        docker compose logs -f
    fi
}

# Main
case "${1:-}" in
    build)
        cmd_build "${2:-prod}"
        ;;
    rebuild)
        cmd_rebuild "${2:-prod}"
        ;;
    push)
        cmd_push "${2:-us-east-2}"
        ;;
    deploy)
        cmd_deploy "${2:-us-east-2}"
        ;;
    deploy-lightsail)
        cmd_deploy_lightsail "${2:-container-service-1}" "${3:-us-east-2}"
        ;;
    start)
        cmd_start "${2:-prod}"
        ;;
    stop)
        cmd_stop "${2:-prod}"
        ;;
    logs)
        cmd_logs "${2:-prod}"
        ;;
    help|--help|-h)
        usage
        ;;
    *)
        echo -e "${RED}Unknown command: $1${NC}"
        echo ""
        usage
        exit 1
        ;;
esac

