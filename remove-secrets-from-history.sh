#!/bin/bash

# Script to remove secrets from git history
# WARNING: This rewrites git history. Only use if you understand the implications.

set -e

echo "=========================================="
echo "  Remove Secrets from Git History"
echo "=========================================="
echo ""
echo "⚠️  WARNING: This will rewrite git history!"
echo "⚠️  Make sure you have a backup!"
echo "⚠️  All collaborators will need to re-clone!"
echo ""
read -p "Are you sure you want to continue? (type 'yes' to confirm): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted."
    exit 0
fi

echo ""
echo "Step 1: Creating backup branch..."
git branch backup-before-secret-removal-$(date +%Y%m%d-%H%M%S)
echo "✓ Backup branch created"
echo ""

echo "Step 2: Removing secrets from git history..."
echo "This may take a few minutes..."

# Remove secrets using git filter-branch
git filter-branch --force --index-filter '
    # Fix LIGHTSAIL_DEPLOYMENT_GUIDE.md
    if git ls-files --error-unmatch LIGHTSAIL_DEPLOYMENT_GUIDE.md > /dev/null 2>&1; then
        git checkout-index --force --index LIGHTSAIL_DEPLOYMENT_GUIDE.md
        sed -i.bak "s/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/YOUR_GOOGLE_CLIENT_SECRET/g" LIGHTSAIL_DEPLOYMENT_GUIDE.md
        sed -i.bak "s/Flatline2!/YOUR_OPENSKY_PASSWORD/g" LIGHTSAIL_DEPLOYMENT_GUIDE.md
        sed -i.bak "s/gmyEuwaSA620GprtqWgiJ2jEEsAc200G/YOUR_FLIGHTAWARE_API_KEY/g" LIGHTSAIL_DEPLOYMENT_GUIDE.md
        sed -i.bak "s/M3FTYY-Q2CLZF-U76MTW-553N/YOUR_N2YO_API_KEY/g" LIGHTSAIL_DEPLOYMENT_GUIDE.md
        rm -f LIGHTSAIL_DEPLOYMENT_GUIDE.md.bak
        git add LIGHTSAIL_DEPLOYMENT_GUIDE.md
    fi
    
    # Fix LIGHTSAIL_QUICK_REFERENCE.md
    if git ls-files --error-unmatch LIGHTSAIL_QUICK_REFERENCE.md > /dev/null 2>&1; then
        git checkout-index --force --index LIGHTSAIL_QUICK_REFERENCE.md
        sed -i.bak "s/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/YOUR_GOOGLE_CLIENT_SECRET/g" LIGHTSAIL_QUICK_REFERENCE.md
        sed -i.bak "s/Flatline2!/YOUR_OPENSKY_PASSWORD/g" LIGHTSAIL_QUICK_REFERENCE.md
        sed -i.bak "s/gmyEuwaSA620GprtqWgiJ2jEEsAc200G/YOUR_FLIGHTAWARE_API_KEY/g" LIGHTSAIL_QUICK_REFERENCE.md
        sed -i.bak "s/M3FTYY-Q2CLZF-U76MTW-553N/YOUR_N2YO_API_KEY/g" LIGHTSAIL_QUICK_REFERENCE.md
        rm -f LIGHTSAIL_QUICK_REFERENCE.md.bak
        git add LIGHTSAIL_QUICK_REFERENCE.md
    fi
' --prune-empty --tag-name-filter cat -- --all

echo ""
echo "Step 3: Cleaning up..."
git reflog expire --expire=now --all
git gc --prune=now --aggressive

echo ""
echo "=========================================="
echo "✓ Secrets removed from git history"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Verify the changes: git log --all --oneline"
echo "2. Test your repository"
echo "3. Force push (if needed): git push --force-with-lease origin <branch>"
echo "4. ⚠️  ROTATE ALL EXPOSED SECRETS immediately!"
echo ""
echo "⚠️  IMPORTANT: All collaborators must re-clone the repository"
echo ""

