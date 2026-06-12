
CREATE POLICY "route-icons: users read own folder"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'route-icons' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "route-icons: users insert own folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'route-icons' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "route-icons: users update own folder"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'route-icons' AND auth.uid()::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'route-icons' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "route-icons: users delete own folder"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'route-icons' AND auth.uid()::text = (storage.foldername(name))[1]);
