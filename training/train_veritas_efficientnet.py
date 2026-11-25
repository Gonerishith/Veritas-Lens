#!/usr/bin/env python3
"""
Veritas Lens - PyTorch EfficientNet-B3 Binary Image Classification Training Script
Designed for Google Colab or local GPU training using GenImage and CIFAKE datasets.
"""

import os
import time
import random
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms, models
from PIL import Image

# Reproducibility
SEED = 42
random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)
if torch.cuda.is_available():
    torch.cuda.manual_seed_all(SEED)

class ForensicDataset(Dataset):
    """
    Binary classification dataset for Veritas Lens.
    Label 0: Real camera photograph
    Label 1: AI-generated / CGI image
    """
    def __init__(self, image_paths, labels, transform=None):
        self.image_paths = image_paths
        self.labels = labels
        self.transform = transform

    def __len__(self):
        return len(self.image_paths)

    def __getitem__(self, idx):
        path = self.image_paths[idx]
        label = self.labels[idx]
        try:
            image = Image.open(path).convert('RGB')
        except Exception:
            # Fallback black image on load error
            image = Image.new('RGB', (224, 224), (0, 0, 0))

        if self.transform:
            image = self.transform(image)
        return image, torch.tensor(label, dtype=torch.float32)

def get_transforms():
    train_transform = transforms.Compose([
        transforms.Resize((256, 256)),
        transforms.RandomCrop(224),
        transforms.RandomHorizontalFlip(p=0.5),
        transforms.ColorJitter(brightness=0.15, contrast=0.15, saturation=0.15, hue=0.05),
        transforms.RandomRotation(degrees=10),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    val_transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.CenterCrop(224),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])
    return train_transform, val_transform

def build_efficientnet_b3(num_classes=1, pretrained=True):
    weights = models.EfficientNet_B3_Weights.DEFAULT if pretrained else None
    model = models.efficientnet_b3(weights=weights)
    
    # Freeze initial feature extraction layers for stable transfer learning
    for param in list(model.parameters())[:-30]:
        param.requires_grad = False

    in_features = model.classifier[1].in_features
    model.classifier = nn.Sequential(
        nn.Dropout(p=0.4, inplace=True),
        nn.Linear(in_features, 512),
        nn.SiLU(inplace=True),
        nn.Dropout(p=0.2, inplace=True),
        nn.Linear(512, num_classes)
    )
    return model

def train_model():
    print("=== Veritas Lens EfficientNet-B3 Training Pipeline ===")
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"Using device: {device}")

    # Placeholder paths - update in Colab with your mounted Google Drive directories
    train_dir = os.environ.get('VERITAS_TRAIN_DIR', './dataset/train')
    val_dir = os.environ.get('VERITAS_VAL_DIR', './dataset/val')

    print(f"Training directory: {train_dir}")
    print(f"Validation directory: {val_dir}")

    # For demonstration / initialization without local dataset folders:
    # In Colab, point VERITAS_TRAIN_DIR to folders containing 'real/' and 'ai/' subdirectories.
    
    model = build_efficientnet_b3(num_classes=1, pretrained=True).to(device)
    criterion = nn.BCEWithLogitsLoss()
    optimizer = optim.AdamW(filter(lambda p: p.requires_grad, model.parameters()), lr=3e-4, weight_decay=1e-4)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=15, eta_min=1e-6)

    print("Model successfully constructed and ready for training data loader binding.")
    return model

if __name__ == '__main__':
    train_model()
