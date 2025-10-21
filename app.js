const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, '../Frontend')));

// Configuración de la base de datos
const dbConfig = {
    server: 'localhost',
    database: 'Tarea2',
    user: 'TareaBases2',
    password: 'TareaBases2',
    options: {
        enableArithAbort: true,
        trustServerCertificate: true
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

let pool;

// Conectar a la base de datos
async function connectDB() {
    try {
        pool = await sql.connect(dbConfig);
        console.log('Conectado a SQL Server');
    } catch (err) {
        console.error('Error conectando a la base de datos:', err);
    }
}

connectDB();

app.post('/api/login', async (req, res) => {
    let transaction;
    
    try {
        const { usuario, contraseña } = req.body;
        
        // Validación básica
        if (!usuario || !contraseña) {
            return res.status(400).json({
                success: false,
                message: 'Usuario y contraseña son requeridos'
            });
        }

        console.log('📝 Intento de login:', { usuario });
        
        // Obtener IP del cliente
        const clientIP = req.ip || 
                        req.connection.remoteAddress || 
                        req.socket.remoteAddress ||
                        (req.connection.socket ? req.connection.socket.remoteAddress : null);
        
        const cleanIP = clientIP ? clientIP.replace('::ffff:', '') : '127.0.0.1';

        // Iniciar transacción
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        const request = new sql.Request(transaction);

        // Configurar parámetros EXACTOS como el SP los espera
        request.input('inUsername', sql.VarChar(64), usuario);
        request.input('inPassword', sql.VarChar(64), contraseña);
        request.input('inIP', sql.VarChar(32), cleanIP);
        request.output('outResultCode', sql.Int);
        request.output('outUserId', sql.Int);

        console.log('🔧 Ejecutando SP dbo.sp_ValidarLogin con parámetros:', {
            username: usuario,
            password: contraseña,
            ip: cleanIP
        });

        const result = await request.execute('dbo.sp_ValidarLogin');

        // Obtener los resultados
        const outResultCode = result.output.outResultCode;
        const outUserId = result.output.outUserId;

        console.log('📊 Resultado del SP dbo.sp_ValidarLogin:', {
            resultCode: outResultCode,
            userId: outUserId
        });

        if (outResultCode === 0) {
            // Login exitoso
            await transaction.commit();
            
            console.log('✅ Login exitoso para usuario ID:', outUserId);
            
            res.json({
                success: true,
                message: 'Login exitoso',
                userId: outUserId,
                username: usuario
            });
            
        } else if (outResultCode === 50001) {
            // Username no existe
            await transaction.commit();
            
            console.log('❌ Usuario no existe:', usuario);
            
            res.status(401).json({
                success: false,
                message: 'Usuario no encontrado',
                resultCode: outResultCode
            });
            
        } else if (outResultCode === 50002) {
            // Password incorrecto
            await transaction.commit();
            
            console.log('❌ Contraseña incorrecta para usuario:', usuario);
            
            res.status(401).json({
                success: false,
                message: 'Contraseña incorrecta',
                resultCode: outResultCode
            });
            
        } else if (outResultCode === 50003) {
            // Login deshabilitado por intentos
            await transaction.commit();
            
            console.log('❌ Usuario bloqueado por intentos:', usuario);
            
            res.status(401).json({
                success: false,
                message: 'Usuario bloqueado por múltiples intentos fallidos. Espere 5 minutos.',
                resultCode: outResultCode
            });
            
        } else if (outResultCode === 50008) {
            // Error de base de datos
            await transaction.rollback();
            
            console.log('❌ Error de base de datos en login');
            
            res.status(500).json({
                success: false,
                message: 'Error interno de base de datos',
                resultCode: outResultCode
            });
            
        } else {
            // Otro error desconocido
            await transaction.rollback();
            
            console.log('❌ Error desconocido en login:', outResultCode);
            
            res.status(500).json({
                success: false,
                message: 'Error en el proceso de login',
                resultCode: outResultCode
            });
        }

    } catch (error) {
        console.error('❌ Error en login:', error);

        if (transaction) {
            try {
                await transaction.rollback();
                console.log('🔄 Transacción revertida');
            } catch (rollbackError) {
                console.error('Error haciendo rollback:', rollbackError);
            }
        }

        // Mensaje más específico según el error
        let errorMessage = 'Error del servidor durante el login';
        
        if (error.message.includes('Could not find stored procedure')) {
            errorMessage = 'Error: El stored procedure dbo.sp_ValidarLogin no existe.';
        } else if (error.message.includes('Timeout')) {
            errorMessage = 'Error: Timeout de conexión a la base de datos';
        }

        res.status(500).json({
            success: false,
            message: errorMessage
        });
    }
});


app.get('/api/empleados/:id/movimientos', async (req, res) => {
    let transaction;
    
    try {
        const empleadoId = parseInt(req.params.id);
        const userId = req.query.userId || 1; 
        const clientIP = req.ip ? req.ip.replace('::ffff:', '') : '127.0.0.1';

        console.log('🔍 Solicitando movimientos para empleado:', {
            empleadoId,
            userId,
            ip: clientIP
        });

        // Validar ID del empleado
        if (!empleadoId || isNaN(empleadoId)) {
            return res.status(400).json({
                success: false,
                message: 'ID de empleado inválido'
            });
        }

        // Iniciar transacción
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        const request = new sql.Request(transaction);
        
        // Configurar parámetros
        request.input('inIdEmpleado', sql.Int, empleadoId);
        request.input('inUserId', sql.Int, parseInt(userId));
        request.input('inIP', sql.VarChar(32), clientIP);
        request.output('outResultCode', sql.Int);

        console.log('🔧 Ejecutando SP sp_ListarMovimientosEmpleado con:', {
            empleadoId,
            userId,
            ip: clientIP
        });

        const result = await request.execute('sp_ListarMovimientosEmpleado');

        const outResultCode = result.output.outResultCode;

        if (outResultCode === 0) {
            await transaction.commit();
            
            console.log(`✅ SP ejecutado correctamente, ${result.recordset.length} movimientos encontrados`);
            
            const movimientos = result.recordset.map(mov => ({
                Id: mov.Id || null, 
                Fecha: mov.Fecha,
                TipoMovimiento: mov.TipoMovimiento,
                Monto: mov.Monto,
                NuevoSaldo: mov.NuevoSaldo,
                UsuarioNombre: mov.UsuarioRegistra,
                IP: mov.PostInIP,
                PostTime: mov.PostTime,
                FechaMovimiento: mov.Fecha
            }));
            
            res.json(movimientos);
            
        } else if (outResultCode === 50008) {
            // Error de base de datos
            await transaction.rollback();
            
            console.log('❌ Error de base de datos en SP sp_ListarMovimientosEmpleado');
            
            res.status(500).json({ 
                success: false, 
                message: 'Error de base de datos al obtener movimientos',
                resultCode: outResultCode
            });
            
        } else {
            await transaction.rollback();
            
            console.log('❌ Error desconocido en SP sp_ListarMovimientosEmpleado:', outResultCode);
            
            res.status(500).json({ 
                success: false, 
                message: 'Error obteniendo movimientos',
                resultCode: outResultCode
            });
        }

    } catch (error) {
        console.error('❌ Error obteniendo movimientos:', error);

        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Error en rollback:', rollbackError);
            }
        }

        let errorMessage = 'Error del servidor al obtener movimientos';
        
        if (error.message.includes('Could not find stored procedure')) {
            errorMessage = 'Error: El stored procedure sp_ListarMovimientosEmpleado no existe.';
        } else if (error.message.includes('Timeout')) {
            errorMessage = 'Error: Timeout de conexión a la base de datos';
        }

        res.status(500).json({ 
            success: false, 
            message: errorMessage + ': ' + error.message
        });
    }
});

// Endpoint para logout
app.post('/api/logout', async (req, res) => {
    try {
        const { userId, username } = req.body;
        
        console.log('📝 Logout realizado:', { userId, username });
        
        res.json({
            success: true,
            message: 'Logout exitoso'
        });
        
    } catch (error) {
        console.error('Error en logout:', error);
        res.json({
            success: false,
            message: 'Logout completado pero con error en bitácora'
        });
    }
});

// Endpoint para obtener puesto
app.get('/api/puestos', async (req, res) => {
    try {
        console.log('🔍 Iniciando obtención de puestos...');
        
        // Verificar si la conexión a BD está activa
        if (!pool || !pool.connected) {
            console.log('⚠️ Pool no conectado, reconectando...');
            await connectDB();
        }

        // Intentar consulta simple primero
        let result;
        try {
            console.log('📋 Ejecutando query de puestos...');
            result = await pool.request().query(`
                SELECT 
                    Id,
                    Nombre
                FROM Puesto 
                ORDER BY Nombre
            `);
            console.log('✅ Query ejecutado correctamente');
        } catch (queryError) {
            console.error('❌ Error en query:', queryError.message);
            
            console.log('🔄 Devolviendo puestos de ejemplo...');
            const puestosEjemplo = [
                { Id: 1, Nombre: 'Albañil' },
                { Id: 2, Nombre: 'Asistente' },
                { Id: 3, Nombre: 'Cajero' },
                { Id: 4, Nombre: 'Camarero' },
                { Id: 5, Nombre: 'Conductor' },
                { Id: 6, Nombre: 'Conserje' },
                { Id: 7, Nombre: 'Cuidador' },
                { Id: 8, Nombre: 'Fontanero' },
                { Id: 9, Nombre: 'Niñera' },
                { Id: 10, Nombre: 'Recepcionista' }
            ];
            
            return res.json(puestosEjemplo);
        }

        console.log(`📊 Puestos obtenidos: ${result.recordset.length} registros`);
        
        if (result.recordset.length === 0) {
            console.log('⚠️ No hay puestos en la BD, usando datos de ejemplo');
            const puestosEjemplo = [
                { Id: 1, Nombre: 'Gerente' },
                { Id: 2, Nombre: 'Supervisor' },
                { Id: 3, Nombre: 'Asistente' }
            ];
            return res.json(puestosEjemplo);
        }

        if (result.recordset.length > 0) {
            console.log('📝 Primer puesto:', result.recordset[0]);
        }

        res.json(result.recordset);
        
    } catch (error) {
        console.error('💥 ERROR CRÍTICO en endpoint /api/puestos:', error);
        console.error('🔍 Stack trace:', error.stack);
        

        const puestosEjemplo = [
            { Id: 1, Nombre: 'Albañil' },
            { Id: 2, Nombre: 'Asistente' },
            { Id: 3, Nombre: 'Cajero' },
            { Id: 4, Nombre: 'Camarero' },
            { Id: 5, Nombre: 'Conductor' }
        ];
        
        res.json(puestosEjemplo);
    }
});

// Endpoint para obtener empleados
app.get('/api/empleados', async (req, res) => {
    let transaction;
    
    try {
        const { filtro } = req.query;
        const userId = 1; 
        const clientIP = req.ip ? req.ip.replace('::ffff:', '') : '127.0.0.1';

        // Iniciar transacción
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        const request = new sql.Request(transaction);
        
        // Configurar parámetros
        request.input('inFiltro', sql.VarChar(100), filtro || null);
        request.input('inUserId', sql.Int, userId);
        request.input('inIP', sql.VarChar(32), clientIP);
        request.output('outResultCode', sql.Int);

        console.log('🔧 Ejecutando SP sp_ListarEmpleados con:', {
            filtro: filtro || 'null',
            userId,
            ip: clientIP
        });

        const result = await request.execute('sp_ListarEmpleados');

        const outResultCode = result.output.outResultCode;

        if (outResultCode === 0) {
            await transaction.commit();
            
            console.log(`✅ SP ejecutado correctamente, ${result.recordset.length} empleados`);
            
            res.json(result.recordset);
            
        } else {
            await transaction.rollback();
            
            console.log('❌ Error en SP sp_ListarEmpleados:', outResultCode);
            
            res.status(500).json({ 
                success: false, 
                message: 'Error obteniendo empleados',
                resultCode: outResultCode
            });
        }

    } catch (error) {
        console.error('❌ Error obteniendo empleados:', error);

        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Error en rollback:', rollbackError);
            }
        }

        res.status(500).json({ 
            success: false, 
            message: 'Error del servidor al obtener empleados: ' + error.message
        });
    }
});

// Insertar empleados
app.post('/api/empleados', async (req, res) => {
    let transaction;
    
    try {
        const { 
            idPuesto, 
            valorDocumentoIdentidad, 
            nombre, 
            fechaContratacion,
            userId 
        } = req.body;

        console.log('📥 Datos recibidos para insertar empleado:', req.body);

        // Validaciones básicas
        if (!idPuesto || !valorDocumentoIdentidad || !nombre || !fechaContratacion) {
            return res.status(400).json({
                success: false,
                message: 'Todos los campos son requeridos'
            });
        }

        const clientIP = req.ip ? req.ip.replace('::ffff:', '') : '127.0.0.1';

        // Iniciar transacción
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        const request = new sql.Request(transaction);

        request.input('inIdPuesto', sql.Int, parseInt(idPuesto));
        request.input('inValorDocumentoIdentidad', sql.VarChar(32), valorDocumentoIdentidad);
        request.input('inNombre', sql.VarChar(128), nombre);
        request.input('inFechaContratacion', sql.Date, fechaContratacion);
        request.input('inUserId', sql.Int, parseInt(userId) || 1);
        request.input('inIP', sql.VarChar(32), clientIP);
        request.output('outResultCode', sql.Int);

        console.log('🔧 Ejecutando SP sp_InsertarEmpleado con:', {
            idPuesto,
            valorDocumentoIdentidad,
            nombre,
            fechaContratacion,
            userId: userId || 1,
            ip: clientIP
        });

        const result = await request.execute('sp_InsertarEmpleado');

        const outResultCode = result.output.outResultCode;

        console.log('📊 Resultado del SP sp_InsertarEmpleado:', outResultCode);

        if (outResultCode === 0) {
            await transaction.commit();
            
            console.log('✅ Empleado insertado exitosamente');
            
            res.json({
                success: true,
                message: 'Empleado insertado correctamente',
                resultCode: outResultCode
            });
            
        } else if (outResultCode === 50010) {
            // Documento no numérico
            await transaction.rollback();
            
            res.status(400).json({
                success: false,
                message: 'La cédula debe contener solo números',
                resultCode: outResultCode
            });
            
        } else if (outResultCode === 50009) {
            // Nombre no alfabético
            await transaction.rollback();
            
            res.status(400).json({
                success: false,
                message: 'El nombre debe contener solo letras y espacios',
                resultCode: outResultCode
            });
            
        } else if (outResultCode === 50004) {
            // Documento duplicado
            await transaction.rollback();
            
            res.status(400).json({
                success: false,
                message: 'Ya existe un empleado con esta cédula',
                resultCode: outResultCode
            });
            
        } else if (outResultCode === 50005) {
            // Nombre duplicado
            await transaction.rollback();
            
            res.status(400).json({
                success: false,
                message: 'Ya existe un empleado con este nombre',
                resultCode: outResultCode
            });
            
        } else {
            await transaction.rollback();
            
            res.status(500).json({
                success: false,
                message: 'Error al insertar empleado',
                resultCode: outResultCode
            });
        }

    } catch (error) {
        console.error('❌ Error insertando empleado:', error);

        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Error en rollback:', rollbackError);
            }
        }

        res.status(500).json({
            success: false,
            message: 'Error del servidor al insertar empleado: ' + error.message
        });
    }
});

// Endpoint para obtener tipos de movimiento
app.get('/api/tipos-movimiento', async (req, res) => {
    try {
        const result = await pool.request().query(`
            SELECT 
                Id,
                Nombre,
                TipoAccion
            FROM TipoMovimiento 
            ORDER BY Id
        `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Error obteniendo tipos de movimiento:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error obteniendo tipos de movimiento' 
        });
    }
});

// Insertar movimiento
app.post('/api/movimientos', async (req, res) => {
    let transaction;
    
    try {
        const { 
            valorDocumentoIdentidad, 
            idTipoMovimiento, 
            monto, 
            userId, 
            ip 
        } = req.body;

        console.log('📥 Datos recibidos:', req.body);

        // Validaciones básicas
        if (!valorDocumentoIdentidad || !idTipoMovimiento || !monto) {
            return res.status(400).json({
                success: false,
                message: 'Cédula, tipo de movimiento y monto son requeridos'
            });
        }

        // Validar que el monto sea un número positivo
        if (isNaN(monto) || monto <= 0) {
            return res.status(400).json({
                success: false,
                message: 'El monto debe ser un número positivo'
            });
        }

        // Iniciar transacción
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        const request = new sql.Request(transaction);

        request.input('inValorDocumentoIdentidad', sql.VarChar(32), valorDocumentoIdentidad);
        request.input('inIdTipoMovimiento', sql.Int, parseInt(idTipoMovimiento));
        request.input('inMonto', sql.Int, parseInt(monto));
        request.input('inUserId', sql.Int, parseInt(userId) || 1);
        request.input('inIP', sql.VarChar(32), ip || '127.0.0.1');
        request.output('outResultCode', sql.Int, 0);

        console.log('🔧 Ejecutando SP con parámetros:', {
            valorDocumentoIdentidad,
            idTipoMovimiento,
            monto,
            userId: userId || 1,
            ip: ip || '127.0.0.1'
        });

        // Ejecutar el stored procedure
        const result = await request.execute('sp_InsertarMovimiento');

        // Obtener el código de resultado
        const outResultCode = result.output.outResultCode;

        console.log('📊 Resultado del SP:', outResultCode);

        // Manejar resultados según el código
        if (outResultCode === 0) {
            await transaction.commit();
            
            console.log('✅ Movimiento insertado exitosamente');
            
            res.json({
                success: true,
                message: 'Movimiento agregado correctamente',
                resultCode: outResultCode
            });
            
        } else if (outResultCode === 50011) {
            // Saldo negativo
            await transaction.rollback();
            
            console.log('❌ Error: Saldo insuficiente');
            
            res.status(400).json({
                success: false,
                message: 'No hay suficiente saldo para realizar esta operación',
                resultCode: outResultCode
            });
            
        } else if (outResultCode === 50008) {
            // Empleado o tipo de movimiento no encontrado
            await transaction.rollback();
            
            console.log('❌ Error: Empleado o tipo de movimiento no encontrado');
            
            res.status(404).json({
                success: false,
                message: 'Empleado o tipo de movimiento no encontrado',
                resultCode: outResultCode
            });
            
        } else {
            await transaction.rollback();
            
            console.log('❌ Error desconocido del SP:', outResultCode);
            
            res.status(400).json({
                success: false,
                message: 'Error al procesar el movimiento',
                resultCode: outResultCode
            });
        }

    } catch (error) {
        console.error('❌ Error agregando movimiento:', error);

        if (transaction) {
            try {
                await transaction.rollback();
                console.log('🔄 Transacción revertida');
            } catch (rollbackError) {
                console.error('Error haciendo rollback:', rollbackError);
            }
        }

        res.status(500).json({
            success: false,
            message: 'Error del servidor al procesar el movimiento'
        });
    }
});

// Actualizar empleado
app.put('/api/empleados/:id', async (req, res) => {
    let transaction;
    
    try {
        const empleadoId = parseInt(req.params.id);
        const { 
            idPuesto, 
            valorDocumentoIdentidad, 
            nombre,
            userId 
        } = req.body;

        console.log('📥 Datos recibidos para actualizar empleado:', {
            empleadoId,
            idPuesto,
            valorDocumentoIdentidad,
            nombre,
            userId
        });

        // Validaciones básicas
        if (!idPuesto || !valorDocumentoIdentidad || !nombre) {
            return res.status(400).json({
                success: false,
                message: 'Todos los campos son requeridos'
            });
        }

        const clientIP = req.ip ? req.ip.replace('::ffff:', '') : '127.0.0.1';

        // Iniciar transacción
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        const request = new sql.Request(transaction);

        request.input('inIdEmpleado', sql.Int, empleadoId);
        request.input('inIdPuesto', sql.Int, parseInt(idPuesto));
        request.input('inValorDocumentoIdentidad', sql.VarChar(32), valorDocumentoIdentidad);
        request.input('inNombre', sql.VarChar(128), nombre);
        request.input('inUserId', sql.Int, parseInt(userId) || 1);
        request.input('inIP', sql.VarChar(32), clientIP);
        request.output('outResultCode', sql.Int);

        console.log('🔧 Ejecutando SP sp_ActualizarEmpleado...');

        const result = await request.execute('sp_ActualizarEmpleado');

        const outResultCode = result.output.outResultCode;

        console.log('📊 Resultado del SP sp_ActualizarEmpleado:', outResultCode);

        // Manejar resultados según el código
        if (outResultCode === 0) {
            await transaction.commit();
            
            console.log('✅ Empleado actualizado exitosamente');
            
            res.json({
                success: true,
                message: 'Empleado actualizado correctamente',
                resultCode: outResultCode
            });
            
        } else if (outResultCode === 50010) {
            // Documento no numérico
            await transaction.rollback();
            
            res.status(400).json({
                success: false,
                message: 'La cédula debe contener solo números',
                resultCode: outResultCode
            });
            
        } else if (outResultCode === 50006) {
            // Documento duplicado en actualización
            await transaction.rollback();
            
            res.status(400).json({
                success: false,
                message: 'Ya existe otro empleado con esta cédula',
                resultCode: outResultCode
            });
            
        } else if (outResultCode === 50007) {
            // Nombre duplicado en actualización
            await transaction.rollback();
            
            res.status(400).json({
                success: false,
                message: 'Ya existe otro empleado con este nombre',
                resultCode: outResultCode
            });
            
        } else if (outResultCode === 50008) {
            // Empleado no existe
            await transaction.rollback();
            
            res.status(404).json({
                success: false,
                message: 'Empleado no encontrado',
                resultCode: outResultCode
            });
            
        } else {
            await transaction.rollback();
            
            res.status(500).json({
                success: false,
                message: 'Error al actualizar empleado',
                resultCode: outResultCode
            });
        }

    } catch (error) {
        console.error('❌ Error actualizando empleado:', error);

        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Error en rollback:', rollbackError);
            }
        }

        res.status(500).json({
            success: false,
            message: 'Error del servidor al actualizar empleado: ' + error.message
        });
    }
});

//Eliminar empleado
app.delete('/api/empleados/:id', async (req, res) => {
    let transaction;
    
    try {
        const empleadoId = parseInt(req.params.id);
        const { userId } = req.body;

        console.log('🗑️ Solicitando eliminar empleado:', {
            empleadoId,
            userId
        });

        const clientIP = req.ip ? req.ip.replace('::ffff:', '') : '127.0.0.1';

        // Iniciar transacción
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        const request = new sql.Request(transaction);

        // Configurar parámetros para el SP
        request.input('inIdEmpleado', sql.Int, empleadoId);
        request.input('inUserId', sql.Int, parseInt(userId) || 1);
        request.input('inIP', sql.VarChar(32), clientIP);
        request.output('outResultCode', sql.Int);

        console.log('🔧 Ejecutando SP sp_EliminarEmpleado...');

        // Ejecutar el stored procedure
        const result = await request.execute('sp_EliminarEmpleado');

        const outResultCode = result.output.outResultCode;

        console.log('📊 Resultado del SP sp_EliminarEmpleado:', outResultCode);

        // Manejar resultados según el código
        if (outResultCode === 0) {
            await transaction.commit();
            
            console.log('✅ Empleado eliminado exitosamente');
            
            res.json({
                success: true,
                message: 'Empleado eliminado correctamente',
                resultCode: outResultCode
            });
            
        } else if (outResultCode === 50008) {
            // Empleado no existe
            await transaction.rollback();
            
            res.status(404).json({
                success: false,
                message: 'Empleado no encontrado',
                resultCode: outResultCode
            });
            
        } else {
            await transaction.rollback();
            
            res.status(500).json({
                success: false,
                message: 'Error al eliminar empleado',
                resultCode: outResultCode
            });
        }

    } catch (error) {
        console.error('❌ Error eliminando empleado:', error);

        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Error en rollback:', rollbackError);
            }
        }

        res.status(500).json({
            success: false,
            message: 'Error del servidor al eliminar empleado: ' + error.message
        });
    }
});

app.get('/api/mi-ip', (req, res) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    res.json({ ip: clientIP });
});

// Endpoint de salud
app.get('/api/health', async (req, res) => {
    try {
        await pool.request().query('SELECT 1 as health');
        res.json({ 
            status: 'OK', 
            database: 'Connected',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'Error', 
            database: 'Disconnected',
            error: error.message 
        });
    }
});


app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../Frontend/login.html'));
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../Frontend/login.html'));
});

app.get('/tabla.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../Frontend/tabla.html'));
});

app.get('/insertar-movimiento.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../Frontend/insertar-movimiento.html'));
});

app.get('/actualizar.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../Frontend/actualizar.html'));
});

app.get('/movimientos.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../Frontend/movimientos.html'));
});

// Manejo de errores global
app.use((error, req, res, next) => {
    console.error('Error global:', error);
    res.status(500).json({
        success: false,
        message: 'Error interno del servidor'
    });
});

// Ruta no encontrada
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Ruta no encontrada'
    });
});

// INICIAR SERVIDOR PARA HAMACHI
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor corriendo en:`);
    console.log(`📍 Local: http://localhost:${PORT}`);
    console.log(`🌐 Red (Hamachi): http://25.46.106.44:${PORT}`);
    console.log(`🔧 Puerto: ${PORT}`);
});

// Manejar errores de puerto en uso
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`❌ Puerto ${PORT} ocupado, intentando con ${Number(PORT) + 1}`);
        const newPort = Number(PORT) + 1;
        app.listen(newPort, '0.0.0.0', () => {
            console.log(`🚀 Servidor corriendo en puerto ${newPort}`);
            console.log(`📍 Local: http://localhost:${newPort}`);
            console.log(`🌐 Red (Hamachi): http://25.46.106.44:${newPort}`);
        });
    } else {
        console.log('❌ Error del servidor:', err);
    }
});

// Manejar cierre graceful
process.on('SIGINT', async () => {
    console.log('\n🛑 Cerrando servidor...');
    if (pool) {
        await pool.close();
    }
    server.close(() => {
        console.log('✅ Servidor cerrado');
        process.exit(0);
    });
});

module.exports = app;