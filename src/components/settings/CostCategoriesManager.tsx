'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Trash2, Edit2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { clientFetch } from '@/lib/client-fetch';
import { useCostCategories, type CostCategory } from '@/hooks/use-cost-categories';

export function CostCategoriesManager() {
  const { categories, reload: fetchCategories } = useCostCategories(() =>
    toast.error('Failed to fetch cost categories'));
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    setLoading(true);
    try {
      const response = await clientFetch('/api/cost-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCategoryName }),
      });

      if (response.ok) {
        setNewCategoryName('');
        fetchCategories();
        toast.success('Category added');
      } else {
        toast.error('Failed to add category');
      }
    } catch {
      toast.error('An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const response = await clientFetch(`/api/cost-categories/${id}`, { method: 'DELETE' });
      if (response.ok) {
        fetchCategories();
        toast.success('Category deleted');
      } else {
        toast.error('Failed to delete category');
      }
    } catch {
      toast.error('An error occurred');
    }
  };

  const startEditing = (category: CostCategory) => {
    setEditingId(category.id);
    setEditingName(category.name);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId || !editingName.trim()) return;

    try {
      const response = await clientFetch(`/api/cost-categories/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingName }),
      });

      if (response.ok) {
        setEditingId(null);
        setEditingName('');
        fetchCategories();
        toast.success('Category updated');
      } else {
        toast.error('Failed to update category');
      }
    } catch {
      toast.error('An error occurred');
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add New Category</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddCategory} className="flex gap-2">
            <Input
              placeholder="Category name"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              disabled={loading}
            />
            <Button type="submit" disabled={loading}>
              <Plus className="mr-2 h-4 w-4" /> Add
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {categories.map((category) => (
          <Card key={category.id}>
            <CardContent className="flex items-center justify-between p-4">
              <span className="font-medium">{category.name}</span>
              <div className="flex gap-2">
                {editingId === category.id ? (
                  <form onSubmit={handleUpdate} className="flex gap-2">
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="h-8 w-32"
                    />
                    <Button type="submit" size="sm">Save</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                  </form>
                ) : (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => startEditing(category)}>
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(category.id)} className="text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {categories.length === 0 && (
          <div className="text-center text-muted-foreground py-8">
            No categories found. Add one above.
          </div>
        )}
      </div>
    </div>
  );
}
