
(function() {
    const SUPABASE_URL = 'https://pzstfcncefssgunyheyl.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB6c3RmY25jZWZzc2d1bnloZXlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3NTg5NjEsImV4cCI6MjA4MTMzNDk2MX0.yGBN6ViOxmB8ruWqqmDORhxfUhD25YH-w-2eVb6xlzk';

    if (!window.supabaseClient) {
        window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
    
    // Hacemos que la variable y las funciones sean globales para el HTML
    window.supabase = window.supabaseClient;
    window.validateInvite = validateInvite; 
    // (Añade aquí el resto de funciones si es necesario, como completeRegistration)
})();




let currentUser = null;
let pendingInviteCode = null;
let selectedImageId = null;

// Cargar datos del usuario desde localStorage
function loadUser() {
    const userData = localStorage.getItem('user');
    if (userData) {
        currentUser = JSON.parse(userData);
        showDashboard();
    }
}

async function validateInvite() {
    const codeInput = document.getElementById('inviteCodeInput');
    const code = codeInput.value.trim();
    const errorMsg = document.getElementById('errorMsg');
    const continueBtn = document.querySelector('.welcome-screen button');
    
    if (!code) {
        showError('Por favor ingresa un código');
        return;
    }

    continueBtn.disabled = true;
    continueBtn.textContent = 'Validando...';
    errorMsg.classList.add('hidden');

    try {
        console.log("Validando código:", code);

        // 1. Verificar si el código existe y no ha sido usado
        const { data: invitation, error: invError } = await supabase
            .from('invitations')
            .select('*')  // Cambiado: solo selecciona los campos de invitations
            .eq('code', code)
            .is('used_by', null)
            .single();

        if (invError || !invitation) {
            console.error("Error invitación:", invError);
            showError('Código inválido o ya utilizado');
            continueBtn.disabled = false;
            continueBtn.textContent = 'Continuar';
            return;
        }

        // 2. Ahora sí, verificar que el creador tenga invitaciones disponibles
        const { data: creator, error: creatorError } = await supabase
            .from('users')
            .select('invitations_remaining')
            .eq('id', invitation.created_by)
            .single();

        if (creatorError || !creator || creator.invitations_remaining <= 0) {
            console.error("Error creador:", creatorError);
            showError('Este código ya no tiene invitaciones disponibles');
            continueBtn.disabled = false;
            continueBtn.textContent = 'Continuar';
            return;
        }

        // 3. Verificar límite de usuarios
        const { data: countData, error: countError } = await supabase
            .rpc('count_total_users');
        
        if (countError) {
            console.error("Error conteo:", countError);
        } else if (countData >= 100) {
            showError('El archivo ha alcanzado su límite de 100 participantes');
            continueBtn.disabled = false;
            continueBtn.textContent = 'Continuar';
            return;
        }

        // Todo bien
        pendingInviteCode = code;
        showRegisterScreen();

    } catch (err) {
        console.error("Error crítico:", err);
        showError('Error de conexión. Revisa la consola (F12).');
    } finally {
        continueBtn.disabled = false;
        continueBtn.textContent = 'Continuar';
    }
}
async function completeRegistration() {
    const usernameInput = document.getElementById('usernameInput');
    let username = usernameInput.value.trim() || "Participante";
    const btn = document.querySelector('.register-screen button');
    
    btn.disabled = true;
    btn.textContent = 'Entrando...';

    try {
        // Generamos un código único para evitar conflictos de base de datos
        const uniqueSuffix = Math.floor(Math.random() * 1000);
        const finalUsername = `${username}_${uniqueSuffix}`;

        const { data: newUser, error: userError } = await supabase
            .from('users')
            .insert({
                username: finalUsername,
                invite_code: generateCode(), 
                invitations_remaining: 0
            })
            .select()
            .single();

        if (userError) {
            // Si el error es por duplicado, avisamos
            if (userError.code === '23505') {
                alert('Ese nombre ya está en uso, intenta con otro.');
            } else {
                throw userError;
            }
            return;
        }

        currentUser = newUser;
        localStorage.setItem('user', JSON.stringify(newUser));
        showDashboard();

    } catch (err) {
        console.error("Error detallado:", err);
        alert('Error en el servidor. Revisa si las políticas RLS de Supabase permiten INSERT.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Comenzar';
    }
}
// Función para generar un código aleatorio simple
function generateCode() {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
}


// Mostrar dashboard
async function showDashboard() {
    document.querySelector('.welcome-screen').classList.remove('active');
    document.querySelector('.register-screen').classList.remove('active');
    document.querySelector('.upload-screen').classList.remove('active');
    document.querySelector('.gallery-screen').classList.remove('active');
    document.querySelector('.dashboard').classList.add('active');

    // Ocultar preview section si está visible
    document.getElementById('previewSection').style.display = 'none';
    document.getElementById('uploadSection').style.display = 'block';
    
    // Ocultar sidebar EXIF si está visible
    closeExifSidebar();

    // Actualizar estadísticas
    const { data: countData } = await supabase.rpc('count_total_users');
    document.getElementById('totalUsers').textContent = countData || 0;
    document.getElementById('remainingInvites').textContent = currentUser.invitations_remaining;

    // Generar enlace de invitación si tiene invitaciones disponibles
    if (currentUser.invitations_remaining > 0) {
        await createInviteLink();
    } else {
        document.getElementById('inviteSection').innerHTML = 
            '<strong>No tienes invitaciones disponibles</strong>';
    }
}

// Crear enlace de invitación
async function createInviteLink() {
    const newCode = generateCode();
    
    const { error } = await supabase
        .from('invitations')
        .insert({
            code: newCode,
            created_by: currentUser.id
        });

    if (!error) {
        // Obtener la URL base correcta
        let baseUrl = window.location.origin + window.location.pathname;
        
        // Si estamos en file://, mostrar instrucciones especiales
        if (baseUrl.startsWith('file://')) {
            baseUrl = 'TU_URL_AQUI'; // El usuario debe reemplazar esto
            document.getElementById('inviteLink').innerHTML = `
                <strong>⚠️ Archivo local detectado</strong><br>
                <small style="color: #666;">Sube el archivo a un servidor web o usa el código directamente:</small><br>
                <strong style="font-size: 18px; color: #4CAF50;">${newCode}</strong>
            `;
            document.querySelector('#inviteSection button').textContent = '📋 Copiar código';
            return;
        }
        
        const link = `${baseUrl}?invite=${newCode}`;
        document.getElementById('inviteLink').textContent = link;
    }
}

// Copiar enlace o código
function copyInviteLink() {
    const linkElement = document.getElementById('inviteLink');
    let textToCopy = linkElement.textContent;
    
    // Si es un código directo (no URL), copiar solo el código
    if (!textToCopy.startsWith('http')) {
        const codeMatch = textToCopy.match(/[a-z0-9]{10}/);
        if (codeMatch) {
            textToCopy = codeMatch[0];
        }
    }
    
    navigator.clipboard.writeText(textToCopy).then(() => {
        alert('¡Copiado al portapapeles!');
    }).catch(() => {
        // Fallback para navegadores antiguos
        const input = document.createElement('input');
        input.value = textToCopy;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        alert('¡Copiado al portapapeles!');
    });
}

// Mostrar error
function showError(msg) {
    const errorMsg = document.getElementById('errorMsg');
    errorMsg.textContent = msg;
    errorMsg.classList.remove('hidden');
}

function showRegisterScreen() {
    document.querySelector('.welcome-screen').classList.remove('active');
    document.querySelector('.register-screen').classList.add('active');
}

// Navegar a subida de imágenes
function goToUpload() {
    document.querySelector('.dashboard').classList.remove('active');
    document.querySelector('.gallery-screen').classList.remove('active');
    document.querySelector('.upload-screen').classList.add('active');
    // Resetear vista
    document.getElementById('previewSection').style.display = 'none';
    document.getElementById('uploadSection').style.display = 'block';
    document.getElementById('imagePreview').innerHTML = '<span style="color: #999;">La previsualización aparecerá aquí</span>';
    document.getElementById('exifPreview').innerHTML = '';
    document.getElementById('imageInput').value = '';
}

// Navegar a galería
function goToGallery() {
    document.querySelector('.dashboard').classList.remove('active');
    document.querySelector('.upload-screen').classList.remove('active');
    loadGallery();
    document.querySelector('.gallery-screen').classList.add('active');
    // Ocultar sidebar al entrar
    closeExifSidebar();
}

// Volver al dashboard
function goToDashboard() {
    document.querySelector('.upload-screen').classList.remove('active');
    document.querySelector('.gallery-screen').classList.remove('active');
    document.querySelector('.dashboard').classList.add('active');
    showDashboard();
}

// Calcular luminosidad de la imagen
async function calculateLuminosity(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        img.onload = () => {
            // Reducir tamaño para cálculo más rápido
            const maxSize = 200;
            let width = img.width;
            let height = img.height;
            
            if (width > height) {
                if (width > maxSize) {
                    height *= maxSize / width;
                    width = maxSize;
                }
            } else {
                if (height > maxSize) {
                    width *= maxSize / height;
                    height = maxSize;
                }
            }
            
            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            
            // Obtener datos de píxeles
            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;
            
            let totalLuminosity = 0;
            const pixelCount = data.length / 4;
            
            // Calcular luminosidad promedio usando fórmula perceptual
            // L = 0.299*R + 0.587*G + 0.114*B
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                const luminosity = 0.299 * r + 0.587 * g + 0.114 * b;
                totalLuminosity += luminosity;
            }
            
            const avgLuminosity = totalLuminosity / pixelCount;
            resolve(parseFloat(avgLuminosity.toFixed(2)));
        };
        
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

// Subir imagen
async function uploadImage() {
    const input = document.getElementById('imageInput');
    const file = input.files[0];
    
    if (!file) {
        alert('Por favor selecciona una imagen');
        return;
    }

    // Validar que sea imagen
    if (!file.type.startsWith('image/')) {
        alert('Solo se permiten archivos de imagen');
        return;
    }

    // Validar tamaño (máximo 10MB)
    if (file.size > 10 * 1024 * 1024) {
        alert('La imagen es demasiado grande. Máximo 10MB');
        return;
    }

    const uploadBtn = document.querySelector('#previewSection button');
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Analizando imagen...';

    try {
        // Calcular luminosidad
        const luminosity = await calculateLuminosity(file);
        console.log('Luminosidad calculada:', luminosity);
        
        uploadBtn.textContent = 'Subiendo...';
        
        // Generar nombre único
        const filename = `${Date.now()}_${Math.random().toString(36).substring(7)}.${file.name.split('.').pop()}`;
        
        // Subir a Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('images')
            .upload(filename, file);

        if (uploadError) throw uploadError;

        // Obtener URL pública
        const { data: urlData } = supabase.storage
            .from('images')
            .getPublicUrl(filename);

        // Guardar metadata en la base de datos CON luminosidad
        const { error: dbError } = await supabase
            .from('images')
            .insert({
                user_id: currentUser.id,
                image_url: urlData.publicUrl,
                luminosity: luminosity
            });

        if (dbError) throw dbError;

        alert(`Imagen subida correctamente\nLuminosidad: ${luminosity.toFixed(0)}/255`);
        goToDashboard();

    } catch (error) {
        console.error('Error al subir imagen:', error);
        alert('Error al subir la imagen. Intenta de nuevo.');
    } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Subir imagen';
    }
}

// Previsualizar imagen antes de subir
function previewImage() {
    const input = document.getElementById('imageInput');
    const file = input.files[0];
    
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        // Mostrar vista previa
        document.getElementById('imagePreview').innerHTML = 
            `<img src="${e.target.result}" alt="Vista previa" style="max-width: 100%; max-height: 300px;">`;
        
        // Mostrar sección de preview y ocultar upload
        document.getElementById('uploadSection').style.display = 'none';
        document.getElementById('previewSection').style.display = 'block';
    };
    reader.readAsDataURL(file);
    
    // Leer y mostrar EXIF
    EXIF.getData(file, function() {
        const allMetaData = EXIF.getAllTags(this);
        console.log("Metadatos EXIF:", allMetaData);
        displayExifPreview(allMetaData);
    });
}

// Mostrar preview de EXIF al subir
function displayExifPreview(exifData) {
    const previewDiv = document.getElementById('exifPreview');
    if (!previewDiv) {
        // Crear el div si no existe
        const newDiv = document.createElement('div');
        newDiv.id = 'exifPreview';
        newDiv.className = 'exif-preview';
        document.getElementById('previewSection').prepend(newDiv);
    }
    
    let html = '<h4> Metadatos EXIF de la imagen:</h4><ul>';
    
    // Mostrar los campos más interesantes
    const interestingFields = {
        'Make': 'Fabricante',
        'Model': 'Modelo',
        'DateTime': 'Fecha y hora',
        'ImageDescription': 'Descripción',
        'Software': 'Software',
        'UserComment': 'Comentario',
        'Artist': 'Autor/Creador',
        'Copyright': 'Copyright',
        'GPSLatitude': 'Latitud GPS',
        'GPSLongitude': 'Longitud GPS'
    };
    
    for (const [field, label] of Object.entries(interestingFields)) {
        if (exifData[field]) {
            html += `<li><strong>${label}:</strong> ${formatExifValue(field, exifData[field])}</li>`;
        }
    }
    
    // Buscar específicamente campos de IA/ComfyUI
    html += checkForAIMetadata(exifData);
    
    html += '</ul>';
    
    document.getElementById('exifPreview').innerHTML = html;
}

// Buscar metadatos de IA
function checkForAIMetadata(exifData) {
    let aiHtml = '';
    
    // Campos donde se suelen guardar prompts de IA
    const aiFields = ['Parameters', 'UserComment', 'ImageDescription', 'XPSubject', 'XPKeywords'];
    
    aiFields.forEach(field => {
        if (exifData[field] && 
            (exifData[field].includes('Steps:') || 
             exifData[field].includes('CFG scale:') ||
             exifData[field].includes('Model:') ||
             exifData[field].includes('prompt:'))) {
            
            aiHtml += `<li class="ai-metadata"><strong> Prompt/Configuración:</strong><br><pre>${exifData[field]}</pre></li>`;
        }
    });
    
    return aiHtml;
}

// Formatear valores EXIF
function formatExifValue(field, value) {
    // Formatear valores específicos
    if (field === 'DateTime') {
        return value.replace(':', '-').replace(':', '-');
    }
    if (field.includes('GPS')) {
        return `${value} (coordenadas sin procesar)`;
    }
    return value;
}

// Cargar galería
async function loadGallery() {
    const gallery = document.getElementById('galleryGrid');
    gallery.innerHTML = '<p style="text-align: center; color: #666;">Cargando imágenes...</p>';

    try {
        const { data: images, error } = await supabase
            .from('images')
            .select('*')
            .order('luminosity', { ascending: true });

        if (error) throw error;

        if (!images || images.length === 0) {
            gallery.innerHTML = '<p style="text-align: center; color: #666;">Aún no hay imágenes en el archivo</p>';
            return;
        }
// Limpiar selección anterior
selectedImageId = null;

// Crear HTML para cada imagen
gallery.innerHTML = images.map((img, index) => {
    const isSelected = selectedImageId === img.id ? 'selected' : '';
    
    return `
        <div class="gallery-item ${isSelected}" onclick="showImageExif('${img.id}', '${img.image_url}', ${img.luminosity || 0}, this)">
            <img src="${img.image_url}" 
                alt="Imagen del archivo" 
                loading="lazy" 
                onerror="this.parentElement.style.display='none';">
        </div>
    `;
}).join('');
    } catch (error) {
        console.error('Error al cargar galería:', error);
        gallery.innerHTML = '<p style="text-align: center; color: #c62828;">Error al cargar las imágenes</p>';
    }
}

// Mostrar EXIF de una imagen en el sidebar
async function showImageExif(imageId, imageUrl, luminosity, element) {
    try {
        // Guardar imagen seleccionada
        selectedImageId = imageId;
        
        // Remover clase 'selected' de todas las imágenes
        document.querySelectorAll('.gallery-item').forEach(item => {
            item.classList.remove('selected');
        });
        
        // Añadir clase 'selected' a la imagen clickeada
        if (element) {
            element.classList.add('selected');
        }
        
        // Mostrar sidebar
        document.getElementById('exifSidebar').classList.add('active');
        
        // Mostrar mensaje de carga
        document.getElementById('exifContent').innerHTML = `
            <div class="exif-loading">
                <p>Cargando metadatos...</p>
                <p><small>Luminosidad: ${luminosity.toFixed(0)}/255</small></p>
            </div>
        `;
        
        // Descargar y leer EXIF
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        
        EXIF.getData(blob, function() {
            const exifData = EXIF.getAllTags(this);
            
            // Mostrar en el sidebar
            displayExifInSidebar(exifData, imageUrl, luminosity);
        });
        
    } catch (error) {
        console.error("Error cargando EXIF:", error);
        document.getElementById('exifContent').innerHTML = `
            <div class="exif-error">
                <p>Error al cargar metadatos</p>
                <p><small>Luminosidad: ${luminosity.toFixed(0)}/255</small></p>
                <button onclick="showImageExif('${imageId}', '${imageUrl}', ${luminosity}, this)">Reintentar</button>
            </div>
        `;
    }
}

// Mostrar EXIF en el sidebar
function displayExifInSidebar(exifData, imageUrl, luminosity) {
    const container = document.getElementById('exifContent');
    
    if (!exifData || Object.keys(exifData).length === 0) {
        container.innerHTML = `
            <div class="no-exif-data">
                <h4> Información de la imagen</h4>
                
                    <img src="${imageUrl}" alt="Vista previa">
                </div>
                <div class="exif-info">
                    <p><strong>Luminosidad:</strong> ${luminosity.toFixed(0)}/255</p>
                    <p><strong>Sin metadatos EXIF</strong></p>
                    <div class="exif-note">
                        <p>Esta imagen no contiene metadatos EXIF. Posibles razones:</p>
                        <ul>
                            <li>Generada por IA</li>
                            <li>Captura de pantalla</li>
                            <li>Editada sin preservar metadatos</li>
                        </ul>
                        
                    </div>
                </div>
            </div>
        `;
        return;
    }
    
    let html = '<div class="exif-data">';
    html += `<h4> Metadatos EXIF</h4>`;
    
    // Vista previa pequeña
    html += `<div class="image-preview-small">
                <img src="${imageUrl}" alt="Vista previa">
                <p><strong>Luminosidad:</strong> ${luminosity.toFixed(0)}/255</p>
            </div>`;
    
    // Agrupar por categorías
    const categories = {
        'Información básica': ['Make', 'Model', 'DateTime', 'Software'],
        'Configuración': ['ExposureTime', 'FNumber', 'ISOSpeedRatings', 'FocalLength'],
        'Datos de imagen': ['ImageWidth', 'ImageHeight', 'BitsPerSample', 'Orientation'],
        'Información personal': ['Artist', 'Copyright', 'ImageDescription'],
        'Datos GPS': ['GPSLatitude', 'GPSLongitude', 'GPSAltitude'],
        'Datos personalizados': ['UserComment', 'Parameters', 'XPSubject', 'XPKeywords']
    };
    
    for (const [category, fields] of Object.entries(categories)) {
        const categoryData = {};
        fields.forEach(field => {
            if (exifData[field]) {
                categoryData[field] = exifData[field];
            }
        });
        
        if (Object.keys(categoryData).length > 0) {
            html += `<div class="exif-category">
                        <h5>${category}</h5>
                        <table>`;
            
            for (const [field, value] of Object.entries(categoryData)) {
                html += `<tr>
                            <td><strong>${field}:</strong></td>
                            <td>${formatExifForSidebar(field, value)}</td>
                         </tr>`;
            }
            
            html += `</table></div>`;
        }
    }
    
    // Botón para ver todos los datos técnicos
    html += `<details class="exif-raw-data">
                <summary>Ver todos los datos técnicos</summary>
                <pre>${JSON.stringify(exifData, null, 2)}</pre>
             </details>`;
    
    html += '</div>';
    container.innerHTML = html;
}

// Formatear EXIF para sidebar
function formatExifForSidebar(field, value) {
    // Formatear valores específicos para mejor legibilidad
    if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
            if (field.includes('GPS') && value.length >= 2) {
                return `${value[0]}° ${value[1]}' ${value[2] || 0}"`;
            }
            return value.join(', ');
        }
        return JSON.stringify(value);
    }
    
    // Formato especial para fechas
    if (field === 'DateTime') {
        return value.replace(/:/g, ':').replace(' ', ' a las ');
    }
    
    // Truncar valores muy largos
    if (typeof value === 'string' && value.length > 50) {
        return value.substring(0, 50) + '...';
    }
    
    return value;
}

// Cerrar sidebar EXIF
function closeExifSidebar() {
    document.getElementById('exifSidebar').classList.remove('active');
    document.querySelectorAll('.gallery-item').forEach(item => {
        item.classList.remove('selected');
    });
    selectedImageId = null;
}

// Verificar si hay código en la URL al cargar
window.addEventListener('load', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const inviteCode = urlParams.get('invite');
    
    if (inviteCode) {
        // Si hay código en la URL, rellenar el input y validar automáticamente
        document.getElementById('inviteCodeInput').value = inviteCode;
        // Esperar un momento para que el DOM esté listo
        setTimeout(() => {
            validateInvite();
        }, 100);
    } else {
        // Si no hay código, intentar cargar usuario existente
        loadUser();
    }
});